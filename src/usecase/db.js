/**
 * DuckDB-WASM: a real analytical SQL engine running inside the browser tab.
 * This is the "environment" the agent's tools act on. No server involved.
 */
const DUCKDB_VERSION = '1.29.0';

export function createDb() {
  let conn = null;

  const ready = (async () => {
    const duckdb = await import(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const logger = duckdb.VoidLogger ? new duckdb.VoidLogger() : new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    conn = await db.connect();
    return db;
  })();

  async function query(sql) {
    await ready;
    const table = await conn.query(sql);
    const fields = table.schema.fields.map((f) => ({ name: f.name, type: String(f.type) }));
    const rows = table.toArray().map((row) => {
      const o = {};
      for (const f of fields) o[f.name] = toPlain(row[f.name], f.type);
      return o;
    });
    return { columns: fields, rows };
  }

  async function loadCsv(name, text) {
    const db = await ready;
    const file = `${name}_${Date.now()}.csv`;
    await db.registerFileText(file, text);
    await conn.query(`CREATE OR REPLACE TABLE "${name}" AS SELECT * FROM read_csv_auto('${file}')`);
  }

  async function tables() {
    const list = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`);
    const out = [];
    for (const { table_name: name } of list.rows) {
      const cols = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${name.replace(/'/g, "''")}' ORDER BY ordinal_position`);
      const count = await query(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`);
      out.push({ name, rows: count.rows[0].n, columns: cols.rows.map((c) => ({ name: c.column_name, type: c.data_type })) });
    }
    return out;
  }

  async function dropTable(name) {
    await query(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
  }

  return { ready, query, loadCsv, tables, dropTable };
}

/** Arrow values → plain JSON-friendly values. */
function toPlain(v, type) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') {
    if (type.startsWith('Timestamp')) return isoTs(Number(v) / (type.includes('MICRO') ? 1000 : type.includes('NANO') ? 1e6 : 1));
    return Number(v);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (type.startsWith('Date') && typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  if (type.startsWith('Timestamp') && typeof v === 'number') return isoTs(v);
  if (type.startsWith('Decimal')) {
    const scale = Number(type.match(/e(\d+)/)?.[1] ?? 0);
    const n = Number(String(v));
    return Number.isFinite(n) && /^-?\d+$/.test(String(v)) ? n / 10 ** scale : String(v);
  }
  if (typeof v === 'object') return typeof v.toJSON === 'function' ? v.toJSON() : String(v);
  return v;
}

const isoTs = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export function tableNameFromFile(filename) {
  let n = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  if (!n) n = 'uploaded';
  if (/^\d/.test(n)) n = `t_${n}`;
  return n;
}
