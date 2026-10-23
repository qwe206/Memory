import { getContext, extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { world_names, loadWorldInfo } from '/scripts/world-info.js';
import { extensionName } from '../utils/settings.js';
import { findActiveSummary } from './names.js';
import { parseLedgerForRefinement } from './ledger.js';
import { chatKey, invalidateMemoryOperations } from './recovery.js';

export async function selectSummaryWorldbook(name) {
  const initial = chatKey(getContext());
  if (name) {
    if (!world_names.includes(name)) throw new Error('世界书不存在，请刷新列表。');
    const entry = findActiveSummary(await loadWorldInfo(name));
    if (!entry) throw new Error('此书没有启用的对话流水总帐或 amily3 总结条目。');
    const parsed = parseLedgerForRefinement(entry.content);
    if (!parsed.valid) throw new Error('总结结构不完整，未接续；请先在酒馆检查原书。');
    if (parsed.totalFloors > getContext().chat.length) throw new Error('旧书进度超过当前聊天楼层，请切到对应聊天再接续。');
  }
  if (chatKey(getContext()) !== initial) throw new Error('聊天已切换，请重新选择。');
  invalidateMemoryOperations();
  const settings = extension_settings[extensionName];
  settings.historiographyWorldbookOverrides ||= {};
  if (name) settings.historiographyWorldbookOverrides[initial] = name;
  else delete settings.historiographyWorldbookOverrides[initial];
  saveSettingsDebounced();
  document.dispatchEvent(new Event('memory:summary-target-changed'));
}
