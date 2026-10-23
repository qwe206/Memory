// Small, consistent line icons. currentColor keeps them in sync with every theme.
const paths = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  exit: '<path d="M10 4H5v16h5m4-12 4 4-4 4m-5-4h12"/>',
  memory: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  floors: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  automatic: '<path d="M18 7a8 8 0 1 0 2 8M18 3v5h-5m-1 0v5l3 2"/>',
  prompts: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
  world: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  archives: '<path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/>',
  'kb-retrieval': '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  'kb-historiography': '<path d="M4 15v5h16v-5M12 3v12m-5-5 5 5 5-5"/>',
  'kb-knowledge-bases': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  'kb-rerank': '<path d="M9 5h12M9 12h8M9 19h4M3 4v16m-2-3 2 3 2-3"/>',
  'kb-advanced': '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  models: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z"/>',
  connections: '<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  independent: '<path d="M4 4h10v12H4zM8 20h12V8h-3M7 8h4M7 12h4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  theme: '<path d="M20 13a8 8 0 0 1-9-9 9 9 0 1 0 9 9Z"/>',
  refresh: '<path d="M20 5v5h-5M4 19v-5h5M5 8a8 8 0 0 1 13-3l2 5M4 14l2 5a8 8 0 0 0 13-3"/>',
};

export function icon(name) {
  return `<svg class="am-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.memory}</svg>`;
}
