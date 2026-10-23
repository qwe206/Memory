import { APP_NAME } from './names.js';

function brandMessage(message) {
  if (typeof message !== 'string') return message;
  // Keep technical identifiers and legacy book/file names accurate in diagnostics.
  return message
    .replace(/(?<![A-Za-z0-9_\/-])amily\s*2\s*号/gi, APP_NAME)
    .replace(/(?<![A-Za-z0-9_\/-])amily\s*2(?![A-Za-z0-9_]|[\/-][A-Za-z0-9_])/gi, APP_NAME);
}

// Scope branding to this extension; never replace the host's global toastr.
export const notify = new Proxy({}, {
  get(_, method) {
    const host = globalThis.toastr;
    if (['info', 'success', 'warning', 'error'].includes(method)) {
      return (message, _title, options) => host?.[method]?.(brandMessage(message), APP_NAME, options);
    }
    const value = host?.[method];
    return typeof value === 'function' ? value.bind(host) : value;
  },
});
