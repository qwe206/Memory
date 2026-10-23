import registry from './ModuleRegistry.js';
import AdditionalFeaturesModule from './AdditionalFeaturesModule.js';
import HanlinyuanModule from './HanlinyuanModule.js';
import ApiConfigModule from './ApiConfigModule.js';
export function registerAllModules() {
 registry.register('AdditionalFeatures', () => new AdditionalFeaturesModule());
 registry.register('Hanlinyuan', () => new HanlinyuanModule());
 registry.register('ApiConfig', () => new ApiConfigModule());
}
