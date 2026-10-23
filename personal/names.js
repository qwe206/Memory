export const APP_NAME = 'Memory';
export const SUMMARY_NAME = '[Memory]总结';
const legacySummaryName = '【敕史局】对话流水总帐';
const summaryNames = [SUMMARY_NAME, '[amily3]总结', legacySummaryName];
export function isSummaryEntry(entry) {
  return entry && summaryNames.includes(entry.comment?.trim());
}
export function isArchivedSummary(entry) {
  return entry && summaryNames.some(name => entry.comment?.trim().startsWith(`${name}_归档_`));
}
export function findActiveSummary(book) {
  const entries = Object.values(book?.entries || {}).filter(Boolean);
  if (entries.some(entry => !entry.disable && /【宏史卷分段开始：\d+-\d+楼】|本条勿动【微言录已续至\d+楼】/u.test(entry.content || ''))) throw new Error('此书使用新版分段格式；当前接续功能适用于单条目对话流水总帐，未修改原书。');
  const active = entries.filter(entry => isSummaryEntry(entry) && !entry.disable);
  if (active.length > 1) throw new Error('此书有多个启用的总结条目，请先在酒馆世界书里确认保留哪一条。');
  return active[0] || null;
}
// Keep the existing book when upgrading, so saved progress is not restarted.
export function summaryBookName(identifier, existingNames) {
  const current = `${SUMMARY_NAME}-${identifier}`;
  const candidates = [current, `[amily3]总结-${identifier}`, `Amily2-Lore-${identifier}`];
  return candidates.find(name => existingNames.includes(name)) || current;
}
