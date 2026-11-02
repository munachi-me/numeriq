import { inspect } from 'node:util';
import { ValidationError } from '../errors/index.js';
import { normalizeValue, inferType, cloneValue, castValue } from '../utils/values.js';
import { renderTable } from '../display/table.js';
import { Series } from './series.js';
import * as stats from '../stats/descriptive.js';
import { NORMALIZED_ROWS } from '../internal.js';

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
    const summaryColumns = ['column', 'count', 'missing', 'distinct', 'mean', 'median', 'min', 'max', 'range', 'variance', 'std'];
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
  select(...columns) { const cols=flatten(columns); cols.forEach(c=>this.#assertColumn(c)); return this.#new(this.#rows.map(r=>Object.fromEntries(cols.map(c=>[c,r[c]]))),cols); }
  dropColumns(...columns) { const drop=new Set(flatten(columns)); const cols=this.#columns.filter(c=>!drop.has(c)); return this.select(...cols); }
  renameColumn(oldName,newName) { this.#assertColumn(oldName); if (!newName || (this.#columns.includes(newName) && newName!==oldName)) throw new ValidationError(`Invalid or duplicate column name: ${newName}`); const cols=this.#columns.map(c=>c===oldName?newName:c); return this.#new(this.#rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k===oldName?newName:k,v]))),cols); }
  filter(predicate) { if (typeof predicate!=='function') throw new ValidationError('filter expects a predicate function.'); return this.#new(this.#rows.filter((r,i)=>predicate({...r},i))); }
  sortBy(column,direction='asc') { this.#assertColumn(column); if (!['asc','desc'].includes(direction)) throw new ValidationError("direction must be 'asc' or 'desc'."); const factor=direction==='asc'?1:-1; const rows=this.rows.sort((a,b)=>{const x=a[column],y=b[column]; if(x==null)return 1;if(y==null)return -1; return (x>y?1:x<y?-1:0)*factor;}); return this.#new(rows); }
  limit(count) { return this.head(count); }
  addColumn(name,valueOrFunction) { if (!name || this.#columns.includes(name)) throw new ValidationError(`Invalid or existing column: ${name}`); const cols=[...this.#columns,name]; const rows=this.#rows.map((r,i)=>({...r,[name]:typeof valueOrFunction==='function'?normalizeValue(valueOrFunction({...r},i),this.#options.normalization):normalizeValue(valueOrFunction,this.#options.normalization)})); return this.#new(rows,cols); }
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
  castColumn(column, type, options = {}) {
    this.#assertColumn(column);
    const errors = options.errors ?? 'throw';
    if (!['throw', 'coerce'].includes(errors)) throw new ValidationError("castColumn errors must be 'throw' or 'coerce'.");
    castValue(null, type, { normalization: this.#options.normalization });
    const rows = this.#rows.map((row, index) => {
      try { return { ...row, [column]: castValue(row[column], type, { normalization: this.#options.normalization }) }; }
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
  #stat(column,method) { this.#assertColumn(column); return stats[method](this.#rows.map(r=>r[column])); }
  #assertColumn(name) { if(!this.#columns.includes(name)) throw new ValidationError(`Unknown column: ${name}`); }
  toJSON() { return { name:this.name, columns:this.columns, shape:this.shape, rows:this.rows, metadata:{...this.metadata}, ...(this.importReport ? { importReport:cloneValue(this.importReport) } : {}) }; }
  toTable(options={}) { return renderTable(this.#rows,this.#columns,{...options,rowCount:this.length,columnCount:this.#columns.length}); }
  display(options={}) { console.log(this.toTable(options)); return this; }
  print(options={}) { return this.display(options); }
  [INSPECT]() { return this.toTable(); }
}
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
