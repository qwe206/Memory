import { notify as toastr } from './notify.js';
import { extension_settings, getContext } from '/scripts/extensions.js';
import { eventSource, event_types, saveSettingsDebounced, setExtensionPrompt } from '/script.js';
import { extensionName, defaultSettings } from '../utils/settings.js';
import { initializeMemoryBus } from '../SL/bus/MemoryBus.js';
import { configManager } from '../utils/config/ConfigManager.js';
import '../utils/config/ApiProfileManager.js';
import { pluginAuthStatus, checkAuthorization } from '../utils/auth.js';
import { createDrawer } from '../ui/drawer.js';
import { initialize, getMemoryStoryContext } from '../core/rag-processor.js';
import { checkAndTriggerAutoSummary, getTargetLorebookName } from '../core/historiographer.js';
import { loadWorldInfo } from '/scripts/world-info.js';
import { findActiveSummary } from './names.js';
import { executeAutoHide } from '../core/autoHideManager.js';
import { applyPersonalFeaturePolicy } from './features.js';
import { migrateMemoryPrompts } from './prompt-style.js';
import { migrateExtensionSettings } from './migration.js';
import { createBackgroundMemoryQueue } from './background-memory.js';
import { chatKey } from './recovery.js';
const afterMessage = createBackgroundMemoryQueue({
 async run() {
  if (!pluginAuthStatus.authorized) return;
  const initialChat = chatKey(getContext());
  getMemoryStoryContext();
  await checkAndTriggerAutoSummary();
  if (pluginAuthStatus.authorized && chatKey(getContext()) === initialChat) await executeAutoHide();
 },
 onError(error) { console.error('[Memory 记忆]', error); toastr.warning(`后台总结未完成，待处理进度已保留：${error.message}`); },
});
const afterChatChanged = createBackgroundMemoryQueue({
 async run() { if (pluginAuthStatus.authorized) { getMemoryStoryContext(); afterMessage(); await executeAutoHide(); } },
 onError(error) { console.error('[Memory 楼层管理]', error); },
});
async function start() {
 migrateExtensionSettings(extension_settings, extensionName);
 const settings = extension_settings[extensionName] ||= {};
 for (const [key,value] of Object.entries(defaultSettings)) if (settings[key] === undefined) settings[key] = structuredClone(value);
 applyPersonalFeaturePolicy(settings);
 settings.iconLocation = 'topbar';
 initializeMemoryBus(); configManager.migrate();
 try { migrateMemoryPrompts(settings); } catch(error) { toastr.warning('提示词备份失败，已保留原设置。');console.error(error); }
 checkAuthorization(); initialize();
 window.memory_rearrangeChat = async (...args) => {
  setExtensionPrompt('MEMORY_STORY_SUMMARY', '', 0, 0);
  if (!pluginAuthStatus.authorized) return;
  const initialChat = chatKey(getContext()), { story } = getMemoryStoryContext();
  const context = getContext(), characterBook = context.characters?.[context.characterId]?.data?.extensions?.world;
  if (story && !story.archived) {
   const name = await getTargetLorebookName();
   if (chatKey(getContext()) !== initialChat) return;
   if (name && name !== characterBook) {
    const book = await loadWorldInfo(name);
    if (chatKey(getContext()) !== initialChat) return;
    const content = findActiveSummary(book)?.content;
    if (content) setExtensionPrompt('MEMORY_STORY_SUMMARY', `以下是当前剧情已发生的总结：\n${content}`, 1, 2, false, 0);
   }
  }
  return window.hanlinyuanRagProcessor?.rearrangeChat(...args);
 };
 await createDrawer();
 eventSource.on(event_types.MESSAGE_RECEIVED, afterMessage);
 eventSource.on(event_types.CHAT_CHANGED, afterChatChanged);
 saveSettingsDebounced();
}
$(start);
