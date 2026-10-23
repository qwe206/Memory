import { notify as toastr } from './notify.js';
import { extension_settings } from '/scripts/extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '/script.js';
import { extensionName, defaultSettings } from '../utils/settings.js';
import { initializeMemoryBus } from '../SL/bus/MemoryBus.js';
import { configManager } from '../utils/config/ConfigManager.js';
import '../utils/config/ApiProfileManager.js';
import { pluginAuthStatus, checkAuthorization } from '../utils/auth.js';
import { createDrawer } from '../ui/drawer.js';
import { initialize } from '../core/rag-processor.js';
import { checkAndTriggerAutoSummary } from '../core/historiographer.js';
import { executeAutoHide } from '../core/autoHideManager.js';
import { applyPersonalFeaturePolicy } from './features.js';
import { migrateMemoryPrompts } from './prompt-style.js';
import { migrateExtensionSettings } from './migration.js';
let busy = false;
async function afterMessage() {
 if (busy || !pluginAuthStatus.authorized) return;
 busy = true;
 try { await checkAndTriggerAutoSummary(); await executeAutoHide(); }
 catch(error) { console.error('[Memory 记忆]', error); }
 finally { busy = false; }
}
async function start() {
 migrateExtensionSettings(extension_settings, extensionName);
 const settings = extension_settings[extensionName] ||= {};
 for (const [key,value] of Object.entries(defaultSettings)) if (settings[key] === undefined) settings[key] = structuredClone(value);
 applyPersonalFeaturePolicy(settings);
 settings.iconLocation = 'topbar';
 initializeMemoryBus(); configManager.migrate();
 try { migrateMemoryPrompts(settings); } catch(error) { toastr.warning('提示词备份失败，已保留原设置。');console.error(error); }
 checkAuthorization(); initialize();
 window.vectors_rearrangeChat = async (...args) => {
  if (pluginAuthStatus.authorized) return window.hanlinyuanRagProcessor?.rearrangeChat(...args);
 };
 await createDrawer();
 eventSource.on(event_types.MESSAGE_RECEIVED, afterMessage);
 eventSource.on(event_types.CHAT_CHANGED, executeAutoHide);
 saveSettingsDebounced();
}
$(start);
