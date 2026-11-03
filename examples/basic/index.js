import {
  createDataset,
  createPipeline,
  createQuery,
  loadCSV,
  loadMany,
  useSampleDataset
} from '../../src/index.js';

// Edit this file to experiment with Numeriq. `npm run dev` reruns it on save.
const sales = await loadCSV('sales.csv');
console.log('LOCAL 25-ROW SALES DATASET');
console.log(sales);
console.log('IMPORT REPORT:', sales.importReport);
console.log('COLUMN PROFILE:', sales.profile());

const sampleTSV = await useSampleDataset('tsv');
console.log('BUNDLED TSV SAMPLE SHAPE:', sampleTSV.shape);

const combined = await loadMany(['sales.csv', 'sales.csv'], { deduplicateBy: ['Transaction_ID'] });
console.log('MULTI-SOURCE IMPORT WITH DUPLICATE REMOVAL:', combined.importReport);

const pipeline = createPipeline([
  { op: 'extractDatePart', column: 'Date', part: 'monthName', options: { as: 'Month' } },
  { op: 'extractDatePart', column: 'Date', part: 'weekday', options: { as: 'Weekday', nameLength: 'short' } },
  { op: 'roundColumn', column: 'Total_Amount', precision: 2 },
  { op: 'flagOutliers', column: 'Total_Amount', options: { as: 'Amount_Outlier' } },
  { op: 'query', query: {
    where: { op: 'and', args: [
      { op: 'eq', column: 'Category', value: 'Electronics' },
      { op: 'gte', column: 'Total_Amount', value: 100 }
    ] },
    orderBy: [{ column: 'Date', direction: 'desc' }, { column: 'Total_Amount', direction: 'desc' }],
    select: ['Date', 'Weekday', 'Month', 'Product', 'Total_Amount', 'Amount_Outlier'],
    limit: 8
  } }
]);
const { dataset: preparedSales, summary } = pipeline.run(sales);
console.log('PIPELINE RESULT (FIRST 8 ROWS)');
console.log(preparedSales.head(8));
console.log('TRANSFORMATION SUMMARY:', summary);
console.log('SERIALIZED PIPELINE:', JSON.stringify(pipeline));

const lowValueQuery = createQuery({
  where: { op: 'lt', column: 'Total_Amount', value: 100 },
  orderBy: [{ column: 'Total_Amount', direction: 'asc' }],
  select: ['Product', 'Category', 'Total_Amount'],
  limit: 5
});
console.log('REUSABLE QUERY:', lowValueQuery.run(sales));

const raw = createDataset([
  { customer: 'Ada', visits: '3', region: 'North' },
  { customer: 'Lin', visits: null, region: 'South' },
  { customer: 'Ada', visits: '3', region: 'North' },
  { customer: null, visits: 'invalid', region: 'West' }
], { normalization: { inferTypes: false } });
const cleaned = raw
  .dropMissing({ columns: ['customer'] })
  .fillMissing('visits', '0')
  .castColumn('visits', 'integer', { errors: 'coerce' })
  .dropDuplicates('customer');
console.log('PROFILE BEFORE CLEANING:', raw.profile());
console.log('CLEANED DATA');
console.log(cleaned);
