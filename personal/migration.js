// Copy existing settings once when the repository folder changes. Keep the
// original settings and persisted internal keys intact for safe rollback.
export function migrateExtensionSettings(settings, target) {
  if (settings[target] && Object.keys(settings[target]).length) return false;
  const source = ['Memory1', 'ST-Amily2', 'ST-Amily2-Chat-Optimisation']
    .find(name => name !== target && settings[name] && Object.keys(settings[name]).length);
  if (!source) return false;
  settings[target] = structuredClone(settings[source]);
  return true;
}
