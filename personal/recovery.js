let recoveryActive = false, recoveryRevision = 0;
export const isMemoryRecovering = () => recoveryActive;
export const getRecoveryRevision = () => recoveryRevision;
export function beginMemoryRecovery() {
  if (recoveryActive) throw new Error('正在恢复归档，请稍候。');
  recoveryActive = true; recoveryRevision++;
}
export function endMemoryRecovery() { recoveryActive = false; recoveryRevision++; }
export function invalidateMemoryOperations() {
  if (recoveryActive) throw new Error('正在归档或恢复，请稍后切换世界书。');
  recoveryRevision++;
}

export function chatKey(context) {
  return JSON.stringify([context.characterId ?? null, context.groupId ?? null, context.chatId ?? context.getCurrentChatId?.() ?? context.chat_filename ?? null]);
}
function messageKey(message) {
  const text = JSON.stringify([message.send_date, message.name, message.is_user, message.mes]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return String(hash >>> 0);
}
export function captureVisibility(context) {
  return { chat: chatKey(context), messages: context.chat.map(message => ({ key: messageKey(message), hidden: Boolean(message.is_system) })) };
}
export function visibilityPlan(context, snapshot, progress) {
  if (!Number.isInteger(progress) || progress < 0 || progress > context.chat.length) throw new Error('归档进度超出当前聊天范围，未恢复。');
  if (snapshot && snapshot.chat !== chatKey(context)) throw new Error('此归档属于另一个聊天，请在原聊天恢复。');
  return context.chat.map((message, index) => {
    const saved = snapshot?.messages?.[index];
    if (saved && saved.key !== messageKey(message)) throw new Error('归档后的聊天内容已修改或移位，无法准确恢复楼层状态。');
    // New messages after the snapshot are visible; old archives fall back to the saved progress.
    return saved ? saved.hidden : snapshot ? false : index < progress;
  });
}
export function visibilityCommands(current, desired) {
  const commands = [];
  for (let i = 0; i < desired.length; i++) {
    if (Boolean(current[i]?.is_system) === desired[i]) continue;
    const start = i, hidden = desired[i];
    while (i + 1 < desired.length && desired[i + 1] === hidden && Boolean(current[i + 1]?.is_system) !== hidden) i++;
    commands.push(`/${hidden ? 'hide' : 'unhide'} ${start}-${i}`);
  }
  return commands;
}

export function summaryOrigin(base, worldbook) {
  if (base.memoryOrigin) return base.memoryOrigin.worldbook === worldbook ? base.memoryOrigin : null;
  if (base.source !== 'lorebook' || !base.name?.startsWith(`${worldbook}: `)) return null;
  const name = base.name.slice(worldbook.length + 2);
  const range = name.match(/^(?:大总结|小总结)\s+(\d+)-(\d+)楼$/u);
  if (range) return { worldbook, startFloor: Number(range[1]), endFloor: Number(range[2]) };
  if (['[Memory]总结', '[amily3]总结', '【敕史局】对话流水总帐', '对话记录小总结', '对话记录大总结'].includes(name)) return { worldbook };
  return null;
}
export function captureKnowledgeState(bases, worldbook) {
  return bases.filter(base => summaryOrigin(base, worldbook)).map(base => ({ id: base.id, owner: base.owner, enabled: Boolean(base.enabled), revision: base.memoryRevision || 0 }));
}
export function knowledgeRestorePlan(bases, worldbook, snapshot, progress) {
  return bases.filter(base => summaryOrigin(base, worldbook)).map(base => {
    const saved = snapshot?.find(item => item.id === base.id && item.owner === base.owner);
    const origin = summaryOrigin(base, worldbook);
    let enabled, reason;
    if (snapshot) {
      enabled = Boolean(saved?.enabled && saved.revision === (base.memoryRevision || 0));
      reason = saved && saved.revision !== (base.memoryRevision || 0) ? '归档后重新入库过，需确认' : '不属于这次归档的启用记忆';
    } else {
      enabled = Boolean(base.enabled && Number.isInteger(origin.endFloor) && origin.endFloor <= progress);
      reason = origin.endFloor ? '超出恢复的总结进度' : '旧库缺少楼层范围，暂时停用';
    }
    return { base, enabled, reason: enabled ? null : reason };
  });
}
