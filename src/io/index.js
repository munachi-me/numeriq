import { createDataset } from '../dataset/dataset.js';
import { ValidationError } from '../errors/index.js';

export function parseJSON(input, options={}) {
  let value; try { value=typeof input==='string'?JSON.parse(input):input; } catch { throw new ValidationError('Invalid JSON input.'); }
  if (Array.isArray(value)) return createDataset(value,options);
  if (value && typeof value==='object') return createDataset(value,options);
  throw new ValidationError('JSON must contain an array of records or column-oriented object.');
}
export function parseCSV(input, options={}) {
  if(typeof input!=='string') throw new ValidationError('CSV input must be a string.');
  const delimiter=options.delimiter ?? detectDelimiter(input);
  const lines=input.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.length>0);
  if(!lines.length) return createDataset([],options);
  const headers=parseLine(lines[0],delimiter).map(h=>h.trim());
  const rows=lines.slice(1).map((line,i)=>{const cells=parseLine(line,delimiter); if(cells.length!==headers.length && options.strict) throw new ValidationError(`CSV row ${i+2} has ${cells.length} cells; expected ${headers.length}.`); return Object.fromEntries(headers.map((h,j)=>[h,cells[j] ?? null]));});
  return createDataset(rows,{...options,columns:headers});
}
function detectDelimiter(text) { const first=text.split(/\r?\n/,1)[0]??''; return [',','\t',';','|'].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0]; }
function parseLine(line,delimiter) { const cells=[]; let cell='',quoted=false; for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===delimiter&&!quoted){cells.push(cell);cell='';}else cell+=ch;}cells.push(cell);return cells; }
