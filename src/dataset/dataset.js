import { inspect } from 'node:util';
import { ValidationError } from '../errors/index.js';
import { normalizeValue, inferType, cloneValue, castValue } from '../utils/values.js';
import { renderTable } from '../display/table.js';
import { Series } from './series.js';
import * as stats from '../stats/descriptive.js';
import { NORMALIZED_ROWS } from '../internal.js';
import { extractDatePart as getDatePart } from '../utils/temporal.js';
import { GroupedDataset } from './grouping.js';
import { evaluateExpression } from './expressions.js';
import { compileCondition } from './query.js';

const INSPECT = Symbol.for('nodejs.util.inspect.custom');
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

export class Dataset {
  #rows; #columns; #options;
  constructor(rows, options = {}) {
    if (!Array.isArray(rows)) throw new ValidationError('Dataset rows must be an array.');
    const { importReport = null, ...datasetOptions } = options;
    const normalized = options[NORMALIZED_ROWS] === true;
    delete datasetOptions[NORMALIZED_ROWS];
    this.#options = { ...datasetOptions };
    const columns = options.columns ? [...options.columns] : [...new Set(rows.flatMap(r => isRecord(r) ? Object.keys(r) : []))];
    if (!columns.length && rows.length && rows.every(Array.isArray)) throw new ValidationError('Provide columns when creating a dataset from arrays of arrays.');
    if (rows.some(r => !isRecord(r) && !Array.isArray(r))) throw new ValidationError('Each row must be an object or an array.');
    this.#columns = columns;
    this.#rows = rows.map((row, i) => {
      const source = Array.isArray(row) ? Object.fromEntries(columns.map((c,j)=>[c,row[j] ?? null])) : row;
      if (Array.isArray(row) && row.length > columns.length) throw new ValidationError(`Row ${i} has more values than there are columns.`);
      return Object.fromEntries(columns.map(c => [c, normalized ? cloneValue(source[c] ?? null) : normalizeValue(source[c], options.normalization)]));
    });
    this.id = options.id ?? `nq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    this.name = options.name ?? 'Dataset';
    this.metadata = Object.freeze({ ...(options.metadata ?? {}) });
    this.importReport = importReport ? deepFreeze(cloneValue(importReport)) : null;
    this.createdAt = new Date();
  }
  get length() { return this.#rows.length; }
  get columns() { return [...this.#columns]; }
  get rows() { return this.#rows.map(r => Object.fromEntries(Object.entries(r).map(([k,v])=>[k,cloneValue(v)]))); }
  get shape() { return [this.length, this.#columns.length]; }
  get ndim() { return 2; }
  get size() { return this.length * this.#columns.length; }
  get empty() { return this.length === 0 || this.#columns.length === 0; }
  get index() { return Array.from({length:this.length},(_,i)=>i); }
  get dtypes() { return Object.fromEntries(this.#columns.map(c=>[c,inferType(this.#rows.map(r=>r[c]))])); }
  get schema() { return Object.fromEntries(this.#columns.map(c=>[c,{name:c,type:inferType(this.#rows.map(r=>r[c])),nullable:this.#rows.some(r=>r[c] == null)}])); }
  #new(rows, columns=this.#columns) { return new Dataset(rows,{...this.#options,columns,name:this.name,metadata:this.metadata,[NORMALIZED_ROWS]:true}); }
  head(n=5) { return this.#new(this.#rows.slice(0,validCount(n))); }
  tail(n=5) { const count=validCount(n); return this.#new(count===0?[]:this.#rows.slice(-count)); }
  preview(n=10) { return this.head(n); }
  info() { return { name:this.name, rows:this.length, columns:this.#columns.length, shape:this.shape, dtypes:this.dtypes, missingValues:this.#columns.reduce((s,c)=>s+this.#rows.filter(r=>r[c]==null).length,0) }; }
  describe(column) {
    const summaryColumns = ['column', 'count', 'missing', 'distinct', 'mean', 'median', 'min', 'max', 'range', 'variance', 'std', 'q1', 'q3', 'iqr', 'mad', 'skewness', 'kurtosis'];
    if (column !== undefined) {
      this.#assertColumn(column);
      return { column, ...stats.describe(this.#rows.map(row => row[column])) };
    }
    const summaries = this.#columns.map(name => ({ column: name, ...stats.describe(this.#rows.map(row => row[name])) }));
    return new Dataset(summaries, { columns: summaryColumns, name: `${this.name} description` });
  }
  profile(options = {}) {
    const topValues = options.topValues ?? 5;
    if (!Number.isInteger(topValues) || topValues < 0) throw new ValidationError('topValues must be a non-negative integer.');
    const duplicateRows = countDuplicateRows(this.#rows, this.#columns);
    const columns = this.#columns.map(name => {
      const values = this.#rows.map(row => row[name]);
      const summary = stats.describe(values);
      const type = this.dtypes[name];
      const categorical = ['string', 'boolean'].includes(type);
      return {
        name,
        type,
        count: summary.count,
        missing: summary.missing,
        missingPercent: percent(summary.missing, this.length),
        distinct: summary.distinct,
        distinctPercent: percent(summary.distinct, summary.count),
        topValues: categorical ? frequentValues(values, topValues) : []
      };
    });
    return {
      name: this.name,
      rowCount: this.length,
      columnCount: this.#columns.length,
      shape: this.shape,
      duplicateRows,
      duplicateRowPercent: percent(duplicateRows, this.length),
      constantColumns: columns.filter(column => column.count > 0 && column.distinct <= 1).map(column => column.name),
      columns
    };
  }
  column(name) { this.#assertColumn(name); return new Series(name,this.#rows.map(r=>r[name])); }
  select(...columns) {
    const cols = flatten(columns);
    if (new Set(cols).size !== cols.length) throw new ValidationError('Selected column names must be unique.');
    cols.forEach(column => this.#assertColumn(column));
    return this.#new(this.#rows.map(row => Object.fromEntries(cols.map(column => [column, row[column]]))), cols);
  }
  dropColumns(...columns) {
    const drop = flatten(columns);
    drop.forEach(column => this.#assertColumn(column));
    const removed = new Set(drop);
    return this.select(this.#columns.filter(column => !removed.has(column)));
  }
  reorderColumns(...columns) {
    const ordered = flatten(columns);
    if (ordered.length !== this.#columns.length || new Set(ordered).size !== ordered.length) {
      throw new ValidationError('reorderColumns requires every existing column exactly once.');
    }
    ordered.forEach(column => this.#assertColumn(column));
    return this.select(ordered);
  }
  renameColumn(oldName, newName) {
    this.#assertColumn(oldName);
    const target = validColumnName(newName);
    if (this.#columns.includes(target) && target !== oldName) throw new ValidationError(`Invalid or duplicate column name: ${target}`);
    const columns = this.#columns.map(column => column === oldName ? target : column);
    const rows = this.#rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key === oldName ? target : key, value])));
    return this.#new(rows, columns);
  }
  renameColumns(mapping) {
    if (!isRecord(mapping) || !Object.keys(mapping).length) throw new ValidationError('renameColumns expects a non-empty object mapping old names to new names.');
    Object.keys(mapping).forEach(column => this.#assertColumn(column));
    const normalized = Object.fromEntries(Object.entries(mapping).map(([from, to]) => [from, validColumnName(to)]));
    const columns = this.#columns.map(column => normalized[column] ?? column);
    if (new Set(columns).size !== columns.length) throw new ValidationError('Renamed column names must be unique.');
    const rows = this.#rows.map(row => Object.fromEntries(this.#columns.map(column => [normalized[column] ?? column, row[column]])));
    return this.#new(rows, columns);
  }
  filter(predicate) { if (typeof predicate!=='function') throw new ValidationError('filter expects a predicate function.'); return this.#new(this.#rows.filter((r,i)=>predicate({...r},i))); }
  sortBy(column,direction='asc') { this.#assertColumn(column); if (!['asc','desc'].includes(direction)) throw new ValidationError("direction must be 'asc' or 'desc'."); const factor=direction==='asc'?1:-1; const rows=this.#rows.map((row,index)=>({row,index})).sort((a,b)=>{const x=a.row[column],y=b.row[column]; if(x==null&&y==null)return a.index-b.index;if(x==null)return 1;if(y==null)return -1; const tx=temporalTimestamp(x),ty=temporalTimestamp(y); if(tx!==null&&ty!==null)return (tx<ty?-1:tx>ty?1:0)*factor||a.index-b.index; return (x>y?1:x<y?-1:0)*factor||a.index-b.index;}).map(item=>item.row); return this.#new(rows); }
  limit(count) { return this.head(count); }
  groupBy(...columns) {
    const keys = flatten(columns);
    if (new Set(keys).size !== keys.length) throw new ValidationError('groupBy key columns must be unique.');
    keys.forEach(column => this.#assertColumn(column));
    return new GroupedDataset(this.rows, this.#columns, keys, this.name,
      (rows, resultColumns, name) => new Dataset(rows, { columns: resultColumns, name }));
  }
  addColumn(name,valueOrFunction) { const target=validColumnName(name); if(this.#columns.includes(target)) throw new ValidationError(`Invalid or existing column: ${target}`); const cols=[...this.#columns,target]; const rows=this.#rows.map((r,i)=>({...r,[target]:typeof valueOrFunction==='function'?normalizeValue(valueOrFunction({...r},i),this.#options.normalization):normalizeValue(valueOrFunction,this.#options.normalization)})); return this.#new(rows,cols); }
  addCalculatedColumn(name, expression) {
    const target = validColumnName(name);
    if (this.#columns.includes(target)) throw new ValidationError(`Invalid or existing column: ${target}`);
    const sample = Object.fromEntries(this.#columns.map(column => [column, 1]));
    evaluateExpression(expression, sample);
    return this.addColumn(target, row => evaluateExpression(expression, row));
  }
  addConditionalColumn(name, condition, thenValue, elseValue) {
    const target = validColumnName(name);
    if (this.#columns.includes(target)) throw new ValidationError(`Invalid or existing column: ${target}`);
    const matches = compileCondition(condition);
    for (const column of matches.columns) this.#assertColumn(column);
    const sample = Object.fromEntries(this.#columns.map(column => [column, 1]));
    evaluateExpression(thenValue, sample);
    evaluateExpression(elseValue, sample);
    return this.addColumn(target, row => evaluateExpression(matches(row) ? thenValue : elseValue, row));
  }
  addCaseColumn(name, cases, defaultValue = null) {
    const target = validColumnName(name);
    if (this.#columns.includes(target)) throw new ValidationError(`Invalid or existing column: ${target}`);
    if (!Array.isArray(cases) || cases.length === 0) throw new ValidationError('addCaseColumn requires a non-empty cases array.');
    const sample = Object.fromEntries(this.#columns.map(column => [column, 1]));
    const compiled = cases.map((item, index) => {
      if (!isRecord(item) || !Object.hasOwn(item, 'when') || !Object.hasOwn(item, 'then')) {
        throw new ValidationError(`addCaseColumn case ${index + 1} requires when and then.`);
      }
      const unknown = Object.keys(item).find(key => !['when', 'then'].includes(key));
      if (unknown) throw new ValidationError(`addCaseColumn case ${index + 1} contains unknown property: ${unknown}`);
      const matches = compileCondition(item.when);
      for (const column of matches.columns) this.#assertColumn(column);
      evaluateExpression(item.then, sample);
      return { matches, value: item.then };
    });
    evaluateExpression(defaultValue, sample);
    return this.addColumn(target, row => {
      const found = compiled.find(item => item.matches(row));
      return evaluateExpression(found ? found.value : defaultValue, row);
    });
  }
  mapRows(mapper) { if(typeof mapper!=='function') throw new ValidationError('mapRows expects a function.'); const rows=this.#rows.map((r,i)=>mapper({...r},i)); return new Dataset(rows,{...this.#options,name:this.name}); }
  dropDuplicates(...columns) { const cols=flatten(columns); const keys=cols.length?cols:this.#columns; const seen=new Set(); return this.filter(r=>{const key=JSON.stringify(keys.map(k=>r[k]));if(seen.has(key))return false;seen.add(key);return true;}); }
  dropMissing(options = {}) {
    const columns = options.columns === undefined ? this.#columns : flatten([options.columns]);
    columns.forEach(column => this.#assertColumn(column));
    if (!columns.length) return this.clone();
    const how = options.how ?? 'any';
    if (!['any', 'all'].includes(how)) throw new ValidationError("dropMissing how must be 'any' or 'all'.");
    return this.#new(this.#rows.filter(row => {
      const missing = columns.map(column => row[column] === null || row[column] === undefined);
      return how === 'any' ? !missing.some(Boolean) : !missing.every(Boolean);
    }));
  }
  fillMissing(column, valueOrFunction) {
    this.#assertColumn(column);
    const rows = this.#rows.map((row, index) => {
      if (row[column] !== null && row[column] !== undefined) return row;
      const value = typeof valueOrFunction === 'function' ? valueOrFunction(cloneValue(row), index) : valueOrFunction;
      return { ...row, [column]: normalizeValue(value, this.#options.normalization) };
    });
    return this.#new(rows);
  }
  splitColumn(column, options = {}) {
    this.#assertColumn(column);
    const delimiter = options.delimiter ?? ' ';
    const into = options.into;
    const dropOriginal = options.dropOriginal ?? true;
    const trim = options.trim ?? true;
    if (typeof delimiter !== 'string' || delimiter.length === 0) throw new ValidationError('splitColumn delimiter must be a non-empty string.');
    if (!Array.isArray(into) || into.length === 0) throw new ValidationError('splitColumn requires an into array of new column names.');
    if (typeof dropOriginal !== 'boolean' || typeof trim !== 'boolean') throw new ValidationError('splitColumn dropOriginal and trim options must be booleans.');
    const names = into.map(validColumnName);
    if (new Set(names).size !== names.length) throw new ValidationError('splitColumn output names must be unique.');
    for (const name of names) {
      if (this.#columns.includes(name) && !(dropOriginal && name === column)) throw new ValidationError(`splitColumn output already exists: ${name}`);
    }
    const originalIndex = this.#columns.indexOf(column);
    const remaining = dropOriginal ? this.#columns.filter(name => name !== column) : [...this.#columns];
    const insertAt = dropOriginal ? originalIndex : originalIndex + 1;
    const columns = [...remaining.slice(0, insertAt), ...names, ...remaining.slice(insertAt)];
    const rows = this.#rows.map(row => {
      const output = { ...row };
      if (dropOriginal) delete output[column];
      const value = row[column];
      const pieces = value == null ? [] : String(value).split(delimiter);
      const values = names.map((_, index) => {
        if (value == null) return null;
        const piece = index === names.length - 1 ? pieces.slice(index).join(delimiter) : pieces[index];
        const result = trim ? piece.trim() : piece;
        return result === '' ? null : result;
      });
      names.forEach((name, index) => { output[name] = values[index]; });
      return output;
    });
    return this.#new(rows, columns);
  }
  combineColumns(name, columns, options = {}) {
    const target = validColumnName(name);
    const sources = flatten([columns]);
    if (sources.length < 2 || new Set(sources).size !== sources.length) throw new ValidationError('combineColumns requires at least two unique source columns.');
    sources.forEach(column => this.#assertColumn(column));
    const separator = options.separator ?? '';
    const skipMissing = options.skipMissing ?? true;
    const dropSource = options.dropSource ?? false;
    if (typeof separator !== 'string') throw new ValidationError('combineColumns separator must be a string.');
    if (typeof skipMissing !== 'boolean' || typeof dropSource !== 'boolean') throw new ValidationError('combineColumns skipMissing and dropSource options must be booleans.');
    if (this.#columns.includes(target) && (!sources.includes(target) || !dropSource)) throw new ValidationError(`combineColumns output already exists: ${target}`);
    const firstIndex = Math.min(...sources.map(column => this.#columns.indexOf(column)));
    const remaining = this.#columns.filter(column => !(dropSource && sources.includes(column)));
    const insertAt = dropSource ? this.#columns.slice(0, firstIndex).filter(column => !sources.includes(column)).length : remaining.length;
    const resultColumns = [...remaining.slice(0, insertAt), target, ...remaining.slice(insertAt)];
    const rows = this.#rows.map(row => {
      const parts = sources.map(column => row[column]).flatMap(value => value === null || value === undefined ? (skipMissing ? [] : ['']) : [String(value)]);
      const output = { ...row };
      if (dropSource) sources.forEach(column => { delete output[column]; });
      output[target] = parts.length ? parts.join(separator) : null;
      return output;
    });
    return this.#new(rows, resultColumns);
  }
  replaceText(column, search, replacement, options = {}) {
    this.#assertColumn(column);
    if (typeof search !== 'string' || search.length === 0 || typeof replacement !== 'string') throw new ValidationError('replaceText requires a non-empty search string and a string replacement.');
    const caseSensitive = options.caseSensitive ?? true;
    const all = options.all ?? true;
    if (typeof caseSensitive !== 'boolean' || typeof all !== 'boolean') throw new ValidationError('replaceText caseSensitive and all options must be booleans.');
    const flags = `${all ? 'g' : ''}${caseSensitive ? '' : 'i'}`;
    const expression = new RegExp(escapeRegExp(search), flags);
    const rows = this.#rows.map(row => ({ ...row, [column]: typeof row[column] === 'string' ? row[column].replace(expression, () => replacement) : row[column] }));
    return this.#new(rows);
  }
  trimColumn(column, options = {}) {
    this.#assertColumn(column);
    const side = options.side ?? 'both';
    if (!['both', 'start', 'end'].includes(side)) throw new ValidationError("trimColumn side must be 'both', 'start', or 'end'.");
    const rows = this.#rows.map(row => {
      const value = row[column];
      if (typeof value !== 'string') return row;
      const trimmed = side === 'start' ? value.trimStart() : side === 'end' ? value.trimEnd() : value.trim();
      return { ...row, [column]: trimmed === '' ? null : trimmed };
    });
    return this.#new(rows);
  }
  changeCase(column, mode = 'lower') {
    this.#assertColumn(column);
    if (!['lower', 'upper', 'title'].includes(mode)) throw new ValidationError("changeCase mode must be 'lower', 'upper', or 'title'.");
    const rows = this.#rows.map(row => {
      const value = row[column];
      if (typeof value !== 'string') return row;
      const changed = mode === 'upper' ? value.toLocaleUpperCase('en-US') : mode === 'lower' ? value.toLocaleLowerCase('en-US') : titleCase(value);
      return { ...row, [column]: changed };
    });
    return this.#new(rows);
  }
  updateColumnWhere(column, predicate, valueOrFunction) {
    this.#assertColumn(column);
    if (typeof predicate !== 'function') throw new ValidationError('updateColumnWhere expects a predicate function.');
    const rows = this.#rows.map((row, index) => {
      if (!predicate(cloneValue(row), index)) return row;
      const value = typeof valueOrFunction === 'function' ? valueOrFunction(cloneValue(row), index) : valueOrFunction;
      return { ...row, [column]: normalizeValue(value, this.#options.normalization) };
    });
    return this.#new(rows);
  }
  roundColumn(column, precision = 0) {
    this.#assertColumn(column);
    if (!Number.isInteger(precision) || precision < 0 || precision > 15) throw new ValidationError('roundColumn precision must be an integer from 0 to 15.');
    const values = this.#rows.map(row => row[column]);
    if (values.some(value => value != null && (typeof value !== 'number' || !Number.isFinite(value)))) throw new ValidationError(`roundColumn requires finite numeric values in column "${column}".`);
    return this.#new(this.#rows.map(row => ({ ...row, [column]: row[column] == null ? null : Number(row[column].toFixed(precision)) })));
  }
  flagOutliers(column, options = {}) {
    this.#assertColumn(column);
    if (!isRecord(options)) throw new ValidationError('flagOutliers options must be an object.');
    const unknownOption = Object.keys(options).find(key => !['method', 'factor', 'threshold', 'ddof', 'as'].includes(key));
    if (unknownOption) throw new ValidationError(`flagOutliers does not support option: ${unknownOption}.`);
    const method = options.method ?? 'iqr';
    const factor = options.factor ?? 1.5;
    const threshold = options.threshold ?? (method === 'modifiedZScore' ? 3.5 : 3);
    const target = validColumnName(options.as ?? `${column}_outlier`);
    if (!['iqr', 'zscore', 'modifiedZScore'].includes(method)) throw new ValidationError("flagOutliers method must be 'iqr', 'zscore', or 'modifiedZScore'.");
    if (method === 'iqr' && (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0)) throw new ValidationError('flagOutliers factor must be a non-negative finite number.');
    if (method !== 'iqr' && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0)) throw new ValidationError('flagOutliers threshold must be a positive finite number.');
    if (method === 'iqr' && options.threshold !== undefined) throw new ValidationError('flagOutliers threshold is only available with zscore methods.');
    if (method !== 'iqr' && options.factor !== undefined) throw new ValidationError('flagOutliers factor is only available with the iqr method.');
    if (method !== 'zscore' && options.ddof !== undefined) throw new ValidationError('flagOutliers ddof is only available with the zscore method.');
    if (this.#columns.includes(target)) throw new ValidationError(`Outlier flag column already exists: ${target}`);
    const present = this.#rows.map(row => row[column]).filter(value => value !== null && value !== undefined);
    if (present.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new ValidationError(`flagOutliers requires finite numeric values in column "${column}".`);
    let scores = null;
    let modifiedFallback = null;
    let lower = -Infinity, upper = Infinity;
    if (method === 'iqr') {
      const sorted = [...present].sort((a, b) => a - b);
      const q1 = sorted.length >= 4 ? stats.quantile(sorted, 0.25) : null;
      const q3 = sorted.length >= 4 ? stats.quantile(sorted, 0.75) : null;
      const spread = q1 === null ? null : q3 - q1;
      lower = spread === null ? -Infinity : q1 - factor * spread;
      upper = spread === null ? Infinity : q3 + factor * spread;
    } else {
      const values = this.#rows.map(row => row[column]);
      scores = method === 'zscore' ? stats.zScores(values, { ddof: options.ddof ?? 0 }) : stats.modifiedZScores(values);
      const medianValue = method === 'modifiedZScore' ? stats.median(present) : null;
      if (method === 'modifiedZScore' && stats.mad(present) === 0 && present.some(value => value !== medianValue)) {
        const q1 = stats.quantile(present, 0.25), q3 = stats.quantile(present, 0.75);
        const spread = q3 - q1;
        modifiedFallback = { lower: q1 - 1.5 * spread, upper: q3 + 1.5 * spread };
      }
    }
    const rows = this.#rows.map((row, index) => ({ ...row, [target]: row[column] == null ? null : method === 'iqr'
      ? row[column] < lower || row[column] > upper
      : scores[index] !== null
        ? Math.abs(scores[index]) > threshold
        : method === 'modifiedZScore' && modifiedFallback !== null
          ? row[column] < modifiedFallback.lower || row[column] > modifiedFallback.upper
          : false }));
    return this.#new(rows, [...this.#columns, target]);
  }
  extractDatePart(column, part, options = {}) {
    this.#assertColumn(column);
    if (!['day', 'weekday', 'week', 'month', 'monthName', 'quarter', 'year'].includes(part)) throw new ValidationError(`Unsupported date part "${part}". Choose day, weekday, week, month, monthName, quarter, or year.`);
    if (!['date', 'datetime'].includes(this.dtypes[column])) throw new ValidationError(`extractDatePart requires a date or datetime column; cast "${column}" first.`);
    const target = validColumnName(options.as ?? `${column}_${part}`);
    if (this.#columns.includes(target)) throw new ValidationError(`Date-part output column already exists: ${target}`);
    const rows = this.#rows.map(row => ({ ...row, [target]: row[column] == null ? null : getDatePart(row[column], part, options) }));
    return this.#new(rows, [...this.#columns, target]);
  }
  castColumn(column, type, options = {}) {
    this.#assertColumn(column);
    const errors = options.errors ?? 'throw';
    if (!['throw', 'coerce'].includes(errors)) throw new ValidationError("castColumn errors must be 'throw' or 'coerce'.");
    castValue(null, type, { normalization: this.#options.normalization, format: options.format });
    const rows = this.#rows.map((row, index) => {
      try { return { ...row, [column]: castValue(row[column], type, { normalization: this.#options.normalization, format: options.format }) }; }
      catch (error) {
        if (errors === 'coerce') return { ...row, [column]: null };
        throw new ValidationError(`Failed to cast column "${column}" at row ${index} to ${type}: ${error.message}`);
      }
    });
    return this.#new(rows);
  }
  unique(column) { this.#assertColumn(column); return [...new Set(this.#rows.map(r=>r[column]))]; }
  nunique(column) { return this.unique(column).filter(v=>v!=null).length; }
  clone() { return this.#new(this.rows); }
  count(column) { return column ? this.column(column).count() : this.length; }
  sum(column) { return this.#stat(column,'sum'); }
  mean(column) { return this.#stat(column,'mean'); }
  median(column) { return this.#stat(column,'median'); }
  min(column) { return this.#stat(column,'min'); }
  max(column) { return this.#stat(column,'max'); }
  range(column) { return this.#stat(column,'range'); }
  variance(column,ddof=0) { this.#assertColumn(column); return stats.variance(this.#rows.map(r=>r[column]),ddof); }
  std(column,ddof=0) { this.#assertColumn(column); return stats.std(this.#rows.map(r=>r[column]),ddof); }
  quantile(column, q, options = {}) { this.#assertColumn(column); return stats.quantile(this.#rows.map(row => row[column]), q, options); }
  percentile(column, percentileValue, options = {}) { this.#assertColumn(column); return stats.percentile(this.#rows.map(row => row[column]), percentileValue, options); }
  quartiles(column, options = {}) { this.#assertColumn(column); return stats.quartiles(this.#rows.map(row => row[column]), options); }
  iqr(column, options = {}) { this.#assertColumn(column); return stats.iqr(this.#rows.map(row => row[column]), options); }
  mad(column) { this.#assertColumn(column); return stats.mad(this.#rows.map(row => row[column])); }
  skewness(column) { this.#assertColumn(column); return stats.skewness(this.#rows.map(row => row[column])); }
  kurtosis(column) { this.#assertColumn(column); return stats.kurtosis(this.#rows.map(row => row[column])); }
  covariance(leftColumn, rightColumn, options = {}) {
    this.#assertColumn(leftColumn); this.#assertColumn(rightColumn);
    return stats.covariance(this.#rows.map(row => row[leftColumn]), this.#rows.map(row => row[rightColumn]), options);
  }
  correlation(leftColumn, rightColumn, options = {}) {
    this.#assertColumn(leftColumn); this.#assertColumn(rightColumn);
    return stats.correlation(this.#rows.map(row => row[leftColumn]), this.#rows.map(row => row[rightColumn]), options);
  }
  zScore(column, options = {}) { return this.#appendScoreColumn(column, options, 'zscore'); }
  modifiedZScore(column, options = {}) { return this.#appendScoreColumn(column, options, 'modifiedZScore'); }
  #appendScoreColumn(column, options, method) {
    this.#assertColumn(column);
    if (!isRecord(options)) throw new ValidationError('Score options must be an object.');
    const allowedOptions = method === 'zscore' ? ['as', 'ddof'] : ['as'];
    const unknownOption = Object.keys(options).find(key => !allowedOptions.includes(key));
    if (unknownOption) throw new ValidationError(`${method} does not support option: ${unknownOption}.`);
    const target = validColumnName(options.as ?? `${column}_${method === 'zscore' ? 'zscore' : 'modified_zscore'}`);
    if (this.#columns.includes(target)) throw new ValidationError(`Score output column already exists: ${target}`);
    const values = this.#rows.map(row => row[column]);
    const scores = method === 'zscore' ? stats.zScores(values, { ddof: options.ddof ?? 0 }) : stats.modifiedZScores(values);
    const rows = this.#rows.map((row, index) => ({ ...row, [target]: scores[index] }));
    return this.#new(rows, [...this.#columns, target]);
  }
  #stat(column,method) { this.#assertColumn(column); return stats[method](this.#rows.map(r=>r[column])); }
  #assertColumn(name) { if(!this.#columns.includes(name)) throw new ValidationError(`Unknown column: ${name}`); }
  toJSON() { return { name:this.name, columns:this.columns, shape:this.shape, rows:this.rows, metadata:{...this.metadata}, ...(this.importReport ? { importReport:cloneValue(this.importReport) } : {}) }; }
  toTable(options={}) { return renderTable(this.#rows,this.#columns,{...options,rowCount:this.length,columnCount:this.#columns.length}); }
  display(options={}) { console.log(this.toTable(options)); return this; }
  print(options={}) { return this.display(options); }
  [INSPECT]() { return this.toTable(); }
}
function validColumnName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Column names must be non-empty strings.');
  return name.trim();
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function temporalTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const text = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : timestamp;
}
function titleCase(value) { return value.toLocaleLowerCase('en-US').replace(/(^|[\s_-])(\p{L})/gu, (_, separator, letter) => `${separator}${letter.toLocaleUpperCase('en-US')}`); }
function validCount(n) { if(!Number.isInteger(n)||n<0) throw new ValidationError('Row count must be a non-negative integer.'); return n; }
function flatten(items) { return items.flat(); }
function percent(numerator, denominator) { return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0; }
function valueKey(value) {
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value && typeof value === 'object') return `object:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}
function countDuplicateRows(rows, columns) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = JSON.stringify(columns.map(column => valueKey(row[column])));
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}
function frequentValues(values, limit) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = valueKey(value);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { value: cloneValue(value), count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
export function createDataset(data,options={}) {
  if(data instanceof Dataset) return data.clone();
  if(Array.isArray(data)) return new Dataset(data,options);
  if(isRecord(data)) {
    const columns=Object.keys(data); const lengths=new Set(columns.map(c=>Array.isArray(data[c])?data[c].length:-1));
    if(lengths.has(-1)||lengths.size>1) throw new ValidationError('Column-oriented data must contain arrays of equal length.');
    const n=columns.length?data[columns[0]].length:0; return new Dataset(Array.from({length:n},(_,i)=>Object.fromEntries(columns.map(c=>[c,data[c][i]]))),{...options,columns});
  }
  throw new ValidationError('Unsupported dataset input.');
}
