import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createDataset } from '../dataset/dataset.js';
import { ValidationError } from '../errors/index.js';

export function parseJSON(input, options = {}) {
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new ValidationError('Invalid JSON input.'); }
  if (Array.isArray(value)) return createDataset(value, options);
  if (value && typeof value === 'object') return createDataset(value, options);
  throw new ValidationError('JSON must contain an array of records or column-oriented object.');
}

export function parseCSV(input, options = {}) {
  if (typeof input !== 'string') throw new ValidationError('CSV input must be a string.');
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = options.delimiter ?? detectDelimiter(text);
  if (typeof delimiter !== 'string' || delimiter.length !== 1) throw new ValidationError('CSV delimiter must be one character.');
  const parsedRows = parseCsvRows(text, delimiter);
  const rows = parsedRows.filter((row) => !(row.length === 1 && row[0].trim() === ''));
  if (!rows.length) return createDataset([], options);
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new ValidationError('CSV header names cannot be empty.');
  if (new Set(headers).size !== headers.length) throw new ValidationError('CSV header names must be unique.');
  const records = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length && options.strict) {
      throw new ValidationError(`CSV row ${index + 2} has ${cells.length} cells; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? null]));
  });
  return createDataset(records, { ...options, columns: headers });
}

export async function loadCSV(source, options = {}) {
  if (sourceExtension(source) === '.json') return loadJSON(source, options);
  const { text } = await readSource(source);
  const extension = sourceExtension(source);
  return parseCSV(text, {
    ...options,
    delimiter: options.delimiter ?? (extension === '.tsv' ? '\t' : undefined),
    name: options.name ?? sourceLabel(source)
  });
}

export async function loadJSON(source, options = {}) {
  const { text } = await readSource(source);
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new ValidationError(`Invalid JSON in ${sourceLabel(source)}: ${error.message}`); }
  return parseJSON(value, { ...options, name: options.name ?? sourceLabel(source) });
}

export async function loadData(source, options = {}) {
  const extension = sourceExtension(source);
  if (['.csv', '.tsv'].includes(extension)) return loadCSV(source, options);
  if (extension === '.json') return loadJSON(source, options);
  throw new ValidationError(`Unsupported data format "${extension || '(no extension)'}". Use .csv, .tsv, or .json.`);
}

async function readSource(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new ValidationError('Provide a local filename under dataset/ or an HTTP(S) URL.');
  }
  if (/^https?:\/\//i.test(source)) {
    let response;
    try { response = await fetch(source); }
    catch (error) { throw new ValidationError(`Could not load URL ${source}: ${error.message}`); }
    if (!response.ok) throw new ValidationError(`Could not load URL ${source}: HTTP ${response.status} ${response.statusText}`);
    return { text: await response.text() };
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(source) || source.startsWith('file:')) {
    throw new ValidationError('Only HTTP(S) URLs are supported. Local files must be inside the project dataset/ directory.');
  }

  const configuredRoot = path.resolve(process.cwd(), 'dataset');
  let datasetRoot;
  try {
    if ((await lstat(configuredRoot)).isSymbolicLink()) throw new ValidationError('The project dataset/ folder must not be a symbolic link.');
    datasetRoot = await realpath(configuredRoot);
  }
  catch (error) {
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
  return { text: await readFile(resolved, 'utf8') };
}

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  const pushField = () => { row.push(field); field = ''; afterQuote = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field !== '' || afterQuote) throw new ValidationError(`Unexpected quote in CSV at character ${i}.`);
      quoted = true;
    } else if (character === delimiter) pushField();
    else if (character === '\n') pushRow();
    else if (character === '\r') { if (text[i + 1] === '\n') i += 1; pushRow(); }
    else if (afterQuote) {
      if (!/\s/.test(character)) throw new ValidationError(`Unexpected character after quoted CSV field at character ${i}.`);
    } else field += character;
  }
  if (quoted) throw new ValidationError('CSV contains an unterminated quoted field.');
  if (field.length || row.length || text.endsWith(delimiter)) pushRow();
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const choices = [',', '\t', ';', '|'].map((delimiter) => {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < firstLine.length; index += 1) {
      const character = firstLine[index];
      if (character === '"' && firstLine[index + 1] === '"' && quoted) index += 1;
      else if (character === '"') quoted = !quoted;
      else if (character === delimiter && !quoted) count += 1;
    }
    return { delimiter, count };
  }).sort((a, b) => b.count - a.count);
  return choices[0].count > 0 ? choices[0].delimiter : ',';
}

function sourceExtension(source) {
  const pathname = typeof source === 'string' && /^https?:\/\//i.test(source) ? new URL(source).pathname : source;
  return typeof pathname === 'string' ? path.extname(pathname).toLowerCase() : '';
}

function sourceLabel(source) {
  const pathname = /^https?:\/\//i.test(source) ? new URL(source).pathname : source;
  return path.basename(pathname, path.extname(pathname)) || 'Dataset';
}
