import { readFile } from 'node:fs/promises';
import { parseCSV, parseJSON } from './parsers.js';
import { ValidationError } from '../errors/index.js';

const SUPPORTED_FORMATS = new Set(['csv', 'tsv', 'json']);

export async function useSampleDataset(formatOrOptions = 'csv', extraOptions = {}) {
  const options = typeof formatOrOptions === 'object' && formatOrOptions !== null
    ? { ...formatOrOptions }
    : { ...extraOptions, format: formatOrOptions };
  const format = String(options.format ?? 'csv').toLowerCase().replace(/^\./, '');
  if (!SUPPORTED_FORMATS.has(format)) throw new ValidationError(`Unsupported sample format "${format}". Choose csv, tsv, or json.`);
  const file = new URL(`../../dataset/samples/sales.${format}`, import.meta.url);
  const text = await readFile(file, 'utf8');
  const common = {
    ...options,
    format,
    source: `sample:sales.${format}`,
    name: options.name ?? `Sample ${format.toUpperCase()}`
  };
  return format === 'json' ? parseJSON(text, common) : parseCSV(text, common);
}
