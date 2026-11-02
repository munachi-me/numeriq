import { createDataset } from '../dataset/dataset.js';
import { ValidationError } from '../errors/index.js';
import { NORMALIZED_ROWS } from '../internal.js';
import { importerNormalization, missingCounts, normalizeImportRecords, validateSkipRows } from './normalization.js';

export function parseCSV(input, options = {}) {
  if (typeof input !== 'string') throw new ValidationError('CSV input must be a string.');
  if (options.header !== undefined && typeof options.header !== 'boolean') throw new ValidationError('header must be true or false.');
  const text = input.replace(/^\uFEFF/, '');
  const warnings = [];
  const delimiter = options.delimiter ?? detectDelimiter(text);
  if (typeof delimiter !== 'string' || delimiter.length !== 1) throw new ValidationError('CSV delimiter must be one character.');
  const parsedRows = parseCsvRows(text, delimiter);
  const blankRowsSkipped = parsedRows.filter(row => row.every(cell => cell.trim() === '')).length;
  const nonBlankRows = parsedRows.filter(row => !row.every(cell => cell.trim() === ''));
  const skipRows = validateSkipRows(options.skipRows);
  const skippedPrefixRows = Math.min(skipRows, nonBlankRows.length);
  const remainingRows = nonBlankRows.slice(skippedPrefixRows);
  const hasHeader = options.header !== false;
  let columns;
  let dataRows;

  if (hasHeader && remainingRows.length) {
    columns = remainingRows[0].map(header => header.trim());
    dataRows = remainingRows.slice(1);
  } else {
    dataRows = remainingRows;
    const width = dataRows.reduce((max, row) => Math.max(max, row.length), 0);
    if (options.columns !== undefined && (!Array.isArray(options.columns) || options.columns.some(name => typeof name !== 'string' || !name.trim()))) {
      throw new ValidationError('columns must be an array of non-empty strings when header is false.');
    }
    columns = options.columns ? options.columns.map(name => name.trim()) : Array.from({ length: width }, (_, index) => `column_${index + 1}`);
    if (columns.length < width && options.strict !== false) {
      throw new ValidationError(`Headerless CSV has ${width} cells but only ${columns.length} column names were supplied.`);
    }
    if (columns.length < width) {
      warnings.push(`Extra cells beyond the ${columns.length} supplied column names were omitted.`);
    }
  }

  validateColumns(columns);
  if (options.header !== false && options.columns !== undefined) {
    if (!Array.isArray(options.columns) || options.columns.some((name, index) => name !== columns[index]) || options.columns.length !== columns.length) {
      throw new ValidationError('columns may only be used with header:false; header names come from the file.');
    }
  }
  const schema = options.schema ?? {};
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const absent = Object.keys(schema).filter(name => !columns.includes(name));
    if (absent.length && ((hasHeader && remainingRows.length) || (!hasHeader && dataRows.length))) {
      throw new ValidationError(`Schema references unknown column(s): ${absent.join(', ')}.`);
    }
    if (absent.length) columns = [...columns, ...absent];
  }

  const strict = options.strict !== false;
  const fixedRows = dataRows.map((cells, rowIndex) => {
    if (cells.length !== columns.length) {
      const message = `CSV data row ${rowIndex + 1} has ${cells.length} cells; expected ${columns.length}.`;
      if (strict) throw new ValidationError(message);
      warnings.push(`${message} Missing cells were padded with null and extra cells were omitted.`);
    }
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? null]));
  });
  const rows = normalizeImportRecords(fixedRows, columns, options, warnings, 'CSV');
  const normalization = importerNormalization(options);
  const importReport = {
    format: options.format ?? (delimiter === '\t' ? 'tsv' : 'csv'),
    source: options.source ?? 'memory',
    delimiter,
    hasHeader,
    skipRows,
    blankRowsSkipped,
    rowsRead: dataRows.length,
    rowsImported: rows.length,
    columns: [...columns],
    missingByColumn: missingCounts(rows, columns),
    warnings
  };
  return createDataset(rows, {
    columns,
    [NORMALIZED_ROWS]: true,
    normalization,
    name: options.name ?? 'CSV Import',
    metadata: options.metadata,
    importReport
  });
}

export function parseJSON(input, options = {}) {
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new ValidationError('Invalid JSON input.'); }
  if (!value || typeof value !== 'object') throw new ValidationError('JSON must contain an array of records or a column-oriented object.');

  const warnings = [];
  let columns = [];
  let records = [];
  let sourceRows = 0;
  if (Array.isArray(value)) {
    sourceRows = value.length;
    if (value.length === 0) {
      columns = Array.isArray(options.columns) ? [...options.columns] : Object.keys(options.schema ?? {});
    } else if (value.every(Array.isArray)) {
      if (!Array.isArray(options.columns) || options.columns.length === 0) throw new ValidationError('Provide columns when importing JSON arrays of arrays.');
      columns = [...options.columns];
      records = value.map((cells, index) => {
        if (cells.length !== columns.length) {
          const message = `JSON row ${index + 1} has ${cells.length} cells; expected ${columns.length}.`;
          if (options.strict !== false) throw new ValidationError(message);
          warnings.push(`${message} Missing cells were padded with null and extra cells were omitted.`);
        }
        return Object.fromEntries(columns.map((column, cellIndex) => [column, cells[cellIndex] ?? null]));
      });
    } else if (value.every(isRecord)) {
      records = value;
      columns = [...new Set(value.flatMap(record => Object.keys(record)))];
      for (const column of Object.keys(options.schema ?? {})) if (!columns.includes(column)) columns.push(column);
    } else {
      throw new ValidationError('JSON record arrays must contain only objects, or arrays with an explicit columns option.');
    }
  } else {
    const keys = Object.keys(value);
    if (!keys.length) {
      columns = Object.keys(options.schema ?? {});
    } else if (keys.every(key => Array.isArray(value[key]))) {
      columns = keys;
      const lengths = new Set(keys.map(key => value[key].length));
      if (lengths.size > 1 && options.strict !== false) throw new ValidationError('Column-oriented JSON arrays must have equal lengths.');
      sourceRows = Math.max(...keys.map(key => value[key].length));
      if (lengths.size > 1) warnings.push('Column-oriented JSON arrays had different lengths; shorter columns were padded with null.');
      records = Array.from({ length: sourceRows }, (_, index) => Object.fromEntries(columns.map(column => [column, value[column][index] ?? null])));
      for (const column of Object.keys(options.schema ?? {})) if (!columns.includes(column)) { columns.push(column); records.forEach(record => { record[column] = null; }); }
    } else {
      throw new ValidationError('JSON objects must contain column-oriented arrays.');
    }
  }

  validateColumns(columns);
  const skipRows = validateSkipRows(options.skipRows);
  const skipped = Math.min(skipRows, records.length);
  records = records.slice(skipped).map(record => Object.fromEntries(columns.map(column => [column, record[column] ?? null])));
  const rows = normalizeImportRecords(records, columns, options, warnings, 'JSON');
  const normalization = importerNormalization(options);
  const importReport = {
    format: 'json',
    source: options.source ?? 'memory',
    skipRows,
    rowsRead: Math.max(0, sourceRows - skipped),
    rowsImported: rows.length,
    columns: [...columns],
    missingByColumn: missingCounts(rows, columns),
    warnings
  };
  return createDataset(rows, {
    columns,
    [NORMALIZED_ROWS]: true,
    normalization,
    name: options.name ?? 'JSON Import',
    metadata: options.metadata,
    importReport
  });
}

function validateColumns(columns) {
  if (!Array.isArray(columns)) throw new ValidationError('Column names must be an array.');
  if (columns.some(column => typeof column !== 'string' || column.trim() === '')) throw new ValidationError('Column names cannot be empty.');
  if (new Set(columns).size !== columns.length) throw new ValidationError('Column names must be unique.');
}

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  const pushField = () => { row.push(field); field = ''; afterQuote = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field !== '' || afterQuote) throw new ValidationError(`Unexpected quote in CSV at character ${index}.`);
      quoted = true;
    } else if (character === delimiter) pushField();
    else if (character === '\n') pushRow();
    else if (character === '\r') { if (text[index + 1] === '\n') index += 1; pushRow(); }
    else if (afterQuote) {
      if (!/\s/.test(character)) throw new ValidationError(`Unexpected character after quoted CSV field at character ${index}.`);
    } else field += character;
  }
  if (quoted) throw new ValidationError('CSV contains an unterminated quoted field.');
  if (field.length || row.length || text.endsWith(delimiter)) pushRow();
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const choices = [',', '\t', ';', '|'].map(delimiter => {
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
