import { createDataset } from '../../src/index.js';

// Edit this file to experiment with Numeriq. `npm run dev` reruns it on save.
const sales = createDataset([
  { product: 'Laptop', price: 1200, quantity: 3 },
  { product: 'Phone', price: 800, quantity: 5 },
  { product: 'Tablet', price: 400, quantity: 2 },
  { product: 'Monitor', price: 650, quantity: 4 }
], { name: 'Sales' });

console.log('DATASET');
console.log(sales);
console.log('SHAPE:', sales.shape);
console.log('SUMMARY:', sales.describe());
console.log('EXPENSIVE PRODUCTS');
console.log(sales.filter(row => row.price > 500).sortBy('price', 'desc').select('product', 'price'));
