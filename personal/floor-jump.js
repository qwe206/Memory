/** Load an existing floor through the host, without changing chat data or render limits. */
export async function ensureFloorRendered(targetId, { getContext, getChatKey, getMessages, loadOlder, renderMessage, yieldToUI, onProgress = () => {} }) {
  const initial = getContext(), key = getChatKey(initial), message = initial.chat?.[targetId];
  if (!Number.isSafeInteger(targetId) || targetId < 0 || !message) {
    throw new Error(`未找到楼层 ${targetId}，请输入当前聊天中存在的楼层编号。`);
  }
  const check = () => {
    const live = getContext();
    if (getChatKey(live) !== key || live.chat?.[targetId] !== message) throw new Error('聊天记录已切换或改变，本次跳转已停止，请重试。');
  };
  const find = () => getMessages().find(node => Number(node.getAttribute('mesid')) === targetId);
  const oldest = nodes => nodes.reduce((first, node) => {
    const id = Number(node.getAttribute('mesid'));
    return Number.isSafeInteger(id) ? Math.min(first, id) : first;
  }, initial.chat.length);
  let target = find();
  while (!target) {
    check();
    const nodes = getMessages();
    const firstId = oldest(nodes);
    if (targetId < firstId && loadOlder) {
      const count = Math.min(100, firstId - Math.max(0, targetId - 10));
      onProgress(`正在加载楼层 ${Math.max(0, firstId - count)}–${firstId - 1}…`);
      await loadOlder(count);
      check();
      target = find();
      const next = getMessages();
      const nextFirst = oldest(next);
      if (!target && nextFirst >= firstId) throw new Error('酒馆未能加载更早的消息，请重试。');
      await yieldToUI();
    } else {
      if (!renderMessage) throw new Error('当前酒馆缺少消息渲染接口，请更新酒馆后重试。');
      // Repair a missing rendered floor in place, retaining chronological order.
      const before = nodes.map(node => Number(node.getAttribute('mesid'))).filter(id => id > targetId).sort((a, b) => a - b)[0];
      await renderMessage(message, { forceId: targetId, insertBefore: before ?? null, scroll: false });
      check(); target = find();
      if (!target) throw new Error('目标楼层未能渲染，请重试。');
    }
  }
  check();
  return target;
}
