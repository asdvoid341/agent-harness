/**
 * Deterministic sample dataset: a fictional office-equipment retailer's 2025
 * orders, plus quarterly revenue targets per region. Generated with a seeded
 * PRNG so every visitor (and the demo scripts) sees the same numbers.
 * All company names are invented.
 */
export const DATA_PROVENANCE =
  'Synthetic data, generated in your browser from a fixed random seed, so every visitor sees the same numbers. A few patterns are built in on purpose (West grows through the year, Electronics spikes in Nov–Dec, some regions beat their targets and some miss) so there is something real to find.';

export const DATA_DICTIONARY = {
  sales: {
    description: 'One row per order placed in 2025 by a fictional office-equipment retailer.',
    columns: {
      order_id: 'Unique order number',
      order_date: 'Date the order was placed (2025)',
      customer: 'Customer company (invented names)',
      segment: 'Customer type: Enterprise, Small Business or Consumer',
      region: 'Sales region: North, South, East or West',
      channel: 'Where the order was placed: Online or Retail',
      category: 'Product category',
      product: 'Product name',
      units: 'Quantity ordered',
      unit_price: 'List price per unit (USD)',
      discount: 'Discount applied, from 0 to 0.15',
      revenue: 'units × unit_price × (1 − discount), in USD',
    },
  },
  targets: {
    description: 'Quarterly revenue targets per region for 2025.',
    columns: {
      region: 'Sales region',
      quarter: 'Quarter, e.g. 2025-Q1',
      revenue_target: 'Revenue target for that region and quarter (USD)',
    },
  },
};

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  { category: 'Electronics', product: 'Laptop', price: 899, w: 3 },
  { category: 'Electronics', product: 'Monitor', price: 249, w: 4 },
  { category: 'Electronics', product: 'Headphones', price: 129, w: 4 },
  { category: 'Electronics', product: 'Keyboard', price: 79, w: 4 },
  { category: 'Furniture', product: 'Standing Desk', price: 449, w: 2 },
  { category: 'Furniture', product: 'Office Chair', price: 229, w: 3 },
  { category: 'Furniture', product: 'Bookshelf', price: 149, w: 2 },
  { category: 'Office Supplies', product: 'Paper (Case)', price: 42, w: 6 },
  { category: 'Office Supplies', product: 'Pens (Box)', price: 9, w: 6 },
  { category: 'Office Supplies', product: 'Notebook Pack', price: 18, w: 5 },
  { category: 'Office Supplies', product: 'Desk Organizer', price: 24, w: 4 },
  { category: 'Apparel', product: 'Hoodie', price: 49, w: 3 },
  { category: 'Apparel', product: 'T-Shirt', price: 19, w: 4 },
  { category: 'Apparel', product: 'Cap', price: 15, w: 3 },
];

// Regional growth per month drives a visible trend (West accelerates through the year).
const REGION_GROWTH = { North: 0.0, South: -0.015, East: 0.012, West: 0.07 };
const TARGET_FACTOR = { North: 0.95, South: 1.12, East: 1.0, West: 0.86 };

const CUSTOMERS = [
  ['Bluefin Labs', 'Enterprise', 'West', 9], ['Cedar & Co', 'Small Business', 'North', 4], ['Driftwood Studio', 'Small Business', 'West', 3],
  ['Ember Analytics', 'Enterprise', 'East', 8], ['Fjord Logistics', 'Enterprise', 'North', 7], ['Granite Health', 'Enterprise', 'South', 6],
  ['Harbor Foods', 'Small Business', 'South', 3], ['Ironleaf Design', 'Small Business', 'East', 3], ['Juniper Schools', 'Enterprise', 'North', 5],
  ['Kestrel Energy', 'Enterprise', 'West', 6], ['Lumen Retail', 'Small Business', 'East', 4], ['Maple Ridge Clinic', 'Small Business', 'North', 2],
  ['Nimbus Software', 'Enterprise', 'West', 7], ['Oakline Legal', 'Small Business', 'South', 2], ['Pinecrest Hotels', 'Enterprise', 'South', 5],
  ['Quarry Works', 'Small Business', 'North', 2], ['Redwood Media', 'Small Business', 'West', 3], ['Saltmarsh Brewing', 'Consumer', 'East', 1],
  ['Tidewater Bank', 'Enterprise', 'East', 6], ['Umber Architects', 'Small Business', 'West', 2], ['Vantage Fitness', 'Consumer', 'South', 1],
  ['Willow Dental', 'Consumer', 'North', 1], ['Yarrow Farms', 'Consumer', 'East', 1], ['Zephyr Travel', 'Consumer', 'West', 1],
].map(([name, segment, region, w]) => ({ name, segment, region, w }));

const MONTH_WEIGHT = [0.9, 0.85, 1.0, 1.0, 1.0, 0.95, 0.9, 0.95, 1.05, 1.1, 1.3, 1.45];

function pick(rand, items, weight) {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = rand() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items.at(-1);
}

export function generateSampleData({ orders = 1500, seed = 2025 } = {}) {
  const rand = mulberry32(seed);
  const rows = [];
  const months = [...Array(12).keys()];
  for (let i = 0; i < orders; i++) {
    const m = pick(rand, months, (k) => MONTH_WEIGHT[k]);
    const day = 1 + Math.floor(rand() * new Date(Date.UTC(2025, m + 1, 0)).getUTCDate());
    const c = pick(rand, CUSTOMERS, (x) => x.w * Math.max(0.2, 1 + REGION_GROWTH[x.region] * m * 1.6));
    const holiday = m >= 10;
    const p = pick(rand, PRODUCTS, (x) => x.w * (holiday && x.category === 'Electronics' ? 1.9 : 1));
    const units = p.category === 'Office Supplies' ? 5 + Math.floor(rand() * 36) : 1 + Math.floor(rand() * rand() * 8);
    const discount = [0, 0, 0, 0.05, 0.1, 0.15][Math.floor(rand() * 6)];
    const revenue = Math.round(units * p.price * (1 - discount) * 100) / 100;
    rows.push({
      order_id: 10001 + i,
      order_date: `2025-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      customer: c.name,
      segment: c.segment,
      region: c.region,
      channel: rand() < 0.62 ? 'Online' : 'Retail',
      category: p.category,
      product: p.product,
      units,
      unit_price: p.price,
      discount,
      revenue,
    });
  }
  rows.sort((a, b) => a.order_date.localeCompare(b.order_date) || a.order_id - b.order_id);
  rows.forEach((r, i) => (r.order_id = 10001 + i));

  // Targets: per region & quarter, derived from actuals so some regions beat and some miss.
  const actual = {};
  for (const r of rows) {
    const q = `2025-Q${Math.floor((Number(r.order_date.slice(5, 7)) - 1) / 3) + 1}`;
    const k = `${r.region}|${q}`;
    actual[k] = (actual[k] ?? 0) + r.revenue;
  }
  const targets = Object.entries(actual)
    .map(([k, v]) => {
      const [region, quarter] = k.split('|');
      return { region, quarter, revenue_target: Math.round((v * TARGET_FACTOR[region]) / 1000) * 1000 };
    })
    .sort((a, b) => a.region.localeCompare(b.region) || a.quarter.localeCompare(b.quarter));

  return { sales: toCsv(rows), targets: toCsv(targets) };
}

function toCsv(rows) {
  const cols = Object.keys(rows[0]);
  const cell = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}
