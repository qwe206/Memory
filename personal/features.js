export const DISABLED_FLAGS = Object.freeze([
  'optimizationEnabled', 'greetingOptimizationEnabled', 'plotOpt_enabled', 'plotOpt_concurrentEnabled',
  'jqyhEnabled', 'plotOpt_worldbookEnabled', 'plotOpt_tableEnabled', 'plotOpt_ejsEnabled', 'plotOpt_combatReportEnabled',
  'super_memory_enabled', 'superMemory_bridgeEnabled', 'superMemory_autoBind', 'show_table_in_chat',
  'progressiveMemoryEnabled', 'progressive_memory_enabled', 'timeRiverEnabled', 'time_river_enabled',
  'combatEnabled', 'combat_enabled', 'autoCharCardEnabled', 'sybdEnabled', 'miZheSiEnabled',
  'tableSystemEnabled', 'table_enabled', 'nccsEnabled', 'secondary_filler_enabled', 'sfigenEnabled',
]);
export function applyPersonalFeaturePolicy(settings) {
  for (const key of DISABLED_FLAGS) Object.defineProperty(settings, key, {
    configurable: true, enumerable: true, get: () => false, set: () => {},
  });
  return settings;
}
