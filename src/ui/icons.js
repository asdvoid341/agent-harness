/**
 * A small, consistent line-icon set (24×24, stroke = currentColor), drawn for
 * this project. One visual language everywhere instead of emoji.
 */
const dot = (cx, cy, r = 1.1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

const P = {
  agent: `<rect x="4.5" y="8" width="15" height="11.5" rx="3.2"/><path d="M12 4.5V8"/>${dot(12, 3.6, 1.2)}${dot(9.4, 13.2)}${dot(14.6, 13.2)}<path d="M9.8 16.4h4.4"/><path d="M2.5 12.5v3M21.5 12.5v3"/>`,
  model: `<path d="M11 3.5l1.9 4.9 4.9 1.9-4.9 1.9L11 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.2 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>`,
  shield: `<path d="M12 3l7 2.8v5.4c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V5.8z"/><path d="M9 12l2.1 2.1L15.2 10"/>`,
  table: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/>`,
  query: `<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>`,
  chart: `<path d="M4 4v16h16"/><path d="M7.5 15l3.8-4.2 3 2.6 4.7-6"/>`,
  note: `<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14.5 3v4.5H19"/><path d="M9 12.5h7M9 16.5h5"/>`,
  memory: `<path d="M12 3.5l8.5 4.6L12 12.7 3.5 8.1z"/><path d="M3.5 12.4L12 17l8.5-4.6"/><path d="M3.5 16.4L12 21l8.5-4.6"/>`,
  chat: `<path d="M4 5h16v11H9.5L5 19.8V16H4z"/>`,
  user: `<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.4-3.8 4.2-5.6 7.5-5.6s6.1 1.8 7.5 5.6"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  checkCircle: `<circle cx="12" cy="12" r="8.8"/><path d="M8.2 12.3l2.6 2.6 5-5.2"/>`,
  x: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  xCircle: `<circle cx="12" cy="12" r="8.8"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>`,
  alert: `<path d="M12 4l9 15.5H3z"/><path d="M12 10v4"/>${dot(12, 16.9)}`,
  hand: `<path d="M8.5 12.5V6.2a1.4 1.4 0 012.8 0v4.8M11.3 10.5V4.9a1.4 1.4 0 012.8 0v5.6M14.1 10.6V6.6a1.4 1.4 0 012.8 0v7.2c0 3.9-2.4 6.7-5.8 6.7-2.3 0-3.8-1.1-5.2-3.2l-2.2-3.5a1.4 1.4 0 012.3-1.6l2.5 3.1"/>`,
  clock: `<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5l3.2 2"/>`,
  compress: `<path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M3.5 20.5L10 14"/>`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
  info: `<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2"/>${dot(12, 7.9)}`,
  book: `<path d="M4.5 5.5A2.5 2.5 0 017 3h12.5v15H7a2.5 2.5 0 00-2.5 2.5z"/><path d="M4.5 20.5v-15"/><path d="M8.5 7.5h7"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>`,
  play: `<circle cx="12" cy="12" r="8.8"/><path d="M10.2 8.6l5 3.4-5 3.4z"/>`,
  retry: `<path d="M4.5 12a7.5 7.5 0 0112.8-5.3L19.5 9"/><path d="M19.5 4v5h-5"/><path d="M19.5 12a7.5 7.5 0 01-12.8 5.3L4.5 15"/><path d="M4.5 20v-5h5"/>`,
  upload: `<path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15v4.5h15V15"/>`,
  reset: `<path d="M4.5 12a7.5 7.5 0 107.5-7.5c-2.4 0-4.4 1.1-5.8 2.8"/><path d="M5.5 3.5v4h4"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>`,
  compass: `<circle cx="12" cy="12" r="8.8"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`,
  download: `<path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>`,
};

export function icon(name, size = 16, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.info}</svg>`;
}

/** Tool name → icon + plain-English label, shared by the chat and the live map. */
export const TOOL_INFO = {
  describe_data: { icon: 'table', title: 'Look at the tables', what: 'Checks which tables and columns exist' },
  run_sql: { icon: 'query', title: 'Run a query', what: 'Asks the database a question in SQL' },
  make_chart: { icon: 'chart', title: 'Draw a chart', what: 'Turns numbers into a picture' },
  save_insight: { icon: 'note', title: 'Save to memory', what: 'Writes down a fact for next time' },
};
