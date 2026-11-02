import {
  createDataset,
  loadCSV,
  loadMany,
  useSampleDataset
} from '../../src/index.js';

// Edit this file to experiment with Numeriq. `npm run dev` reruns it on save.
const sales = await loadCSV('sales.csv');
console.log('LOCAL CSV DATASET');
console.log(sales);
console.log('IMPORT REPORT:', sales.importReport);
console.log('COLUMN PROFILE:', sales.profile());

const sampleTSV = await useSampleDataset('tsv');
console.log('BUNDLED TSV SAMPLE');
console.log(sampleTSV);

const combined = await loadMany(['sales.csv', 'sales.csv'], { deduplicateBy: ['product'] });
console.log('MULTI-SOURCE IMPORT WITH DUPLICATE REMOVAL');
console.log(combined.importReport);

const raw = createDataset([
  { customer: 'Ada', visits: '3', region: 'North' },
  { customer: 'Lin', visits: null, region: 'South' },
  { customer: 'Ada', visits: '3', region: 'North' },
  { customer: null, visits: 'invalid', region: 'West' }
], { normalization: { inferTypes: false } });
const prepared = raw
  .dropMissing({ columns: ['customer'] })
  .fillMissing('visits', '0')
  .castColumn('visits', 'integer', { errors: 'coerce' })
  .dropDuplicates('customer');
console.log('PROFILE BEFORE CLEANING:', raw.profile());
console.log('CLEANED DATA');
console.log(prepared);
