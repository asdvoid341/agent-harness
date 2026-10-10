import { DATA_DICTIONARY, DATA_PROVENANCE } from '../usecase/sample-data.js';
import { sourceUrl } from '../config.js';
import { esc } from './util.js';

/** "About the data": a data dictionary built from the live tables plus known descriptions. */
export function createDataDictionary({ dialog, db }) {
  const body = dialog.querySelector('[data-el="dict-body"]');

  async function open(focusTable) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    dialog.showModal();
    try {
      const tables = await db.tables();
      const sections = await Promise.all(
        tables.map(async (t) => {
          const known = DATA_DICTIONARY[t.name];
          const sample = await db.query(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 1`).catch(() => ({ rows: [] }));
          const ex = sample.rows[0] ?? {};
          return `<section class="dict-table" id="dict-${esc(t.name)}">
            <h4><code>${esc(t.name)}</code> <span class="muted small">${t.rows.toLocaleString()} rows · ${t.columns.length} columns</span></h4>
            <p>${esc(known?.description ?? 'Uploaded by you. Column meanings are not documented, but types are detected automatically.')}</p>
            <div class="table-wrap"><table>
              <thead><tr><th>Column</th><th>Type</th><th>Meaning</th><th>Example</th></tr></thead>
              <tbody>${t.columns
                .map((c) => `<tr><td><code>${esc(c.name)}</code></td><td class="muted">${esc(c.type)}</td><td>${esc(known?.columns?.[c.name] ?? '')}</td><td class="muted">${esc(ex[c.name] ?? '')}</td></tr>`)
                .join('')}</tbody>
            </table></div>
          </section>`;
        }),
      );
      body.innerHTML = `
        <p class="dict-prov">${esc(DATA_PROVENANCE)} <a href="${sourceUrl('src/usecase/sample-data.js')}" target="_blank" rel="noopener">How it's generated ↗</a></p>
        ${sections.join('')}`;
      if (focusTable) body.querySelector(`#dict-${CSS.escape(focusTable)}`)?.scrollIntoView({ block: 'start' });
    } catch (err) {
      body.innerHTML = `<p class="muted">The database isn't available: ${esc(err.message)}</p>`;
    }
  }

  return { open };
}
