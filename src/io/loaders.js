import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createDataset } from '../dataset/dataset.js';
import { ValidationError } from '../errors/index.js';
import { NORMALIZED_ROWS } from '../internal.js';
import { parseCSV, parseJSON } from './parsers.js';

export async function loadCSV(source, options = {}) {
  if (!options.format && sourceExtension(source) === 'json') return loadJSON(source, options);
  const { text } = await readSource(source, options);
  const format = normalizeFormat(options.format ?? (sourceExtension(source) || 'csv'));
  if (!['csv', 'tsv'].includes(format)) throw new ValidationError(`loadCSV format must be csv or tsv; received ${format}.`);
  return parseCSV(text, {
    ...options,
    delimiter: options.delimiter ?? (format === 'tsv' ? '\t' : undefined),
    format,
    source: sourceLabel(source),
    name: options.name ?? sourceLabel(source)
  });
}

export async function loadJSON(source, options = {}) {
  const { text } = await readSource(source, options);
  return parseJSON(text, {
    ...options,
    source: sourceLabel(source),
    name: options.name ?? sourceLabel(source)
  });
}

export async function loadData(source, options = {}) {
  const explicitFormat = options.format ? normalizeFormat(options.format) : null;
  const extensionFormat = sourceExtension(source);
  if (explicitFormat && !['csv', 'tsv', 'json'].includes(explicitFormat)) {
    throw new ValidationError(`Unsupported format "${explicitFormat}". Use csv, tsv, or json.`);
  }
  if (explicitFormat === 'json' || (!explicitFormat && extensionFormat === 'json')) return loadJSON(source, options);
  if (explicitFormat === 'csv' || explicitFormat === 'tsv' || ['csv', 'tsv'].includes(extensionFormat)) return loadCSV(source, options);

  const { text, contentType } = await readSource(source, options);
  const format = formatFromContentType(contentType);
  if (format === 'json') return parseJSON(text, { ...options, source: sourceLabel(source), name: options.name ?? sourceLabel(source) });
  if (format === 'csv' || format === 'tsv') {
    return parseCSV(text, {
      ...options,
      delimiter: options.delimiter ?? (format === 'tsv' ? '\t' : undefined),
      format,
      source: sourceLabel(source),
      name: options.name ?? sourceLabel(source)
    });
  }
  throw new ValidationError(`Could not determine the data format for ${sourceLabel(source)}. Set options.format to csv, tsv, or json.`);
}

export async function loadMany(sources, options = {}) {
  if (!Array.isArray(sources)) throw new ValidationError('loadMany expects an array of sources.');
  const columnStrategy = options.columnStrategy ?? 'union';
  if (!['union', 'strict'].includes(columnStrategy)) throw new ValidationError("columnStrategy must be 'union' or 'strict'.");
  const loaded = await Promise.all(sources.map(async (entry, index) => {
    const descriptor = typeof entry === 'string' ? { source: entry } : entry;
    if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.source !== 'string') {
      throw new ValidationError(`Source ${index + 1} must be a filename/URL or an object with a source string.`);
    }
    const { source, ...sourceOptions } = descriptor;
    return loadData(source, { ...options, ...sourceOptions, source: undefined });
  }));

  const columns = [];
  for (const dataset of loaded) {
    if (columnStrategy === 'strict' && columns.length && !sameColumns(columns, dataset.columns)) {
      throw new ValidationError(`Source columns do not match under columnStrategy "strict": ${dataset.columns.join(', ')}.`);
    }
    for (const column of dataset.columns) if (!columns.includes(column)) columns.push(column);
  }
  const rows = loaded.flatMap(dataset => dataset.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null]))));
  const rowsBeforeDeduplication = rows.length;
  let outputRows = rows;
  const deduplicateBy = options.deduplicateBy === undefined ? [] : (Array.isArray(options.deduplicateBy) ? options.deduplicateBy : [options.deduplicateBy]);
  let duplicatesRemoved = 0;
  if (deduplicateBy.length) {
    const unknown = deduplicateBy.filter(column => !columns.includes(column));
    if (unknown.length) throw new ValidationError(`deduplicateBy references unknown column(s): ${unknown.join(', ')}.`);
    const seen = new Set();
    outputRows = rows.filter(row => {
      const key = JSON.stringify(deduplicateBy.map(column => stableValue(row[column])));
      if (seen.has(key)) { duplicatesRemoved += 1; return false; }
      seen.add(key);
      return true;
    });
  }
  const reports = loaded.map(dataset => dataset.importReport);
  const importReport = {
    format: 'multiple',
    sourceCount: loaded.length,
    sources: reports,
    columns: [...columns],
    rowsRead: reports.reduce((sum, report) => sum + (report?.rowsRead ?? 0), 0),
    rowsImported: outputRows.length,
    duplicatesRemoved,
    warnings: reports.flatMap(report => report?.warnings ?? [])
  };
  return createDataset(outputRows, {
    columns,
    [NORMALIZED_ROWS]: true,
    name: options.name ?? 'Combined import',
    importReport
  });
}

async function readSource(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new ValidationError('Provide a local filename under dataset/ or an HTTP(S) URL.');
  if (/^https?:\/\//i.test(source)) {
    let response;
    try { response = await fetch(source, requestOptions(options)); }
    catch (error) { throw new ValidationError(`Could not load URL ${source}: ${error.message}`); }
    if (!response.ok) throw new ValidationError(`Could not load URL ${source}: HTTP ${response.status} ${response.statusText}`);
    return { text: await response.text(), contentType: response.headers.get('content-type') ?? '' };
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(source) || source.startsWith('file:')) {
    throw new ValidationError('Only HTTP(S) URLs are supported. Local files must be inside the project dataset/ directory.');
  }

  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  let realProjectRoot;
  try { realProjectRoot = await realpath(projectRoot); }
  catch (error) {
    if (error.code === 'ENOENT') throw new ValidationError(`Project root not found: ${projectRoot}`);
    throw error;
  }
  const configuredRoot = path.join(realProjectRoot, 'dataset');
  let datasetRoot;
  try {
    if ((await lstat(configuredRoot)).isSymbolicLink()) throw new ValidationError('The project dataset/ folder must not be a symbolic link.');
    datasetRoot = await realpath(configuredRoot);
  } catch (error) {
    if (error.code === 'ENOENT') throw new ValidationError(`Local data folder not found: ${configuredRoot}. Create dataset/ beside package.json and put your files there.`);
    throw error;
  }
  const candidate = path.resolve(datasetRoot, source);
  let resolved;
  try { resolved = await realpath(candidate); }
  catch (error) {
    if (error.code === 'ENOENT') throw new ValidationError(`Data file not found in dataset/: ${source}`);
    throw error;
  }
  const relative = path.relative(datasetRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ValidationError('Local data files must stay inside the project dataset/ directory.');
  }
  return { text: await readFile(resolved, 'utf8'), contentType: '' };
}

function requestOptions(options) {
  const method = String(options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers ?? {});
  const init = { method, headers };
  if (options.signal !== undefined) init.signal = options.signal;
  if (options.body !== undefined && options.body !== null) {
    if (method === 'GET' || method === 'HEAD') throw new ValidationError(`${method} requests cannot include a body.`);
    const body = options.body;
    const plainObject = body && typeof body === 'object' && (Object.getPrototypeOf(body) === Object.prototype || Array.isArray(body));
    if (plainObject) {
      init.body = JSON.stringify(body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else {
      init.body = body;
    }
  }
  return init;
}

function sourceExtension(source) {
  if (typeof source !== 'string') return '';
  const pathname = /^https?:\/\//i.test(source) ? new URL(source).pathname : source;
  return path.extname(pathname).slice(1).toLowerCase();
}
function sourceLabel(source) {
  const pathname = /^https?:\/\//i.test(source) ? new URL(source).pathname : source;
  return path.basename(pathname, path.extname(pathname)) || 'Dataset';
}
function normalizeFormat(format) { return String(format).toLowerCase().replace(/^\./, ''); }
function formatFromContentType(contentType) {
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type === 'text/tab-separated-values' || type === 'application/tsv') return 'tsv';
  if (type === 'text/csv' || type === 'application/csv') return 'csv';
  return null;
}
function stableValue(value) {
  if (value instanceof Date) return ['date', value.toISOString()];
  if (value && typeof value === 'object') return ['object', JSON.stringify(value)];
  return [typeof value, value];
}
function sameColumns(first, second) { return first.length === second.length && first.every((column, index) => column === second[index]); }
