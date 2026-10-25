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

/** Scroll the actual chat viewport and verify visibility before reporting success. */
export async function revealFloorInChat(target, { container, closeMenu, nextFrame, validate = () => {}, getStyle = getComputedStyle, elementAtPoint = (x, y) => document.elementFromPoint(x, y) }) {
  if (!container || !container.contains(target)) throw new Error('目标楼层已不在当前聊天区，请重试。');
  validate();
  await closeMenu();
  await nextFrame();
  validate();
  target.hidden = false;
  if (getStyle(target).display === 'none') target.style.setProperty('display', 'flex', 'important');
  if (!container.clientHeight || !target.getClientRects().length) throw new Error('聊天区当前不可见，无法定位目标楼层。');
  const oldBehavior = container.style.getPropertyValue('scroll-behavior');
  const oldPriority = container.style.getPropertyPriority('scroll-behavior');
  container.style.setProperty('scroll-behavior', 'auto', 'important');
  const scroll = () => {
    const box = container.getBoundingClientRect(), row = target.getBoundingClientRect();
    const top = container.scrollTop + row.top - box.top - container.clientTop - Math.max(0, (container.clientHeight - row.height) / 2);
    container.scrollTop = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
  };
  const visible = () => {
    if (!target.isConnected || !container.contains(target)) return false;
    const box = container.getBoundingClientRect(), row = target.getBoundingClientRect();
    const top = Math.max(row.top, box.top + container.clientTop, 0);
    const bottom = Math.min(row.bottom, box.top + container.clientTop + container.clientHeight, globalThis.innerHeight || Infinity);
    const left = Math.max(row.left, box.left, 0), right = Math.min(row.right, box.right, globalThis.innerWidth || Infinity);
    return row.height > 0 && bottom > top && right > left && target.contains(elementAtPoint((left + right) / 2, (top + bottom) / 2));
  };
  try {
    scroll(); await nextFrame(); validate();
    // Native media/layout adjustments can move the viewport after rendering.
    if (!visible()) { scroll(); await nextFrame(); validate(); }
    if (!visible()) throw new Error('目标楼层已加载，但聊天区未能滚动到目标，请重试。');
    target.classList.add('am-floor-jump-target');
    setTimeout(() => target.classList.remove('am-floor-jump-target'), 2500);
  } finally {
    if (oldBehavior) container.style.setProperty('scroll-behavior', oldBehavior, oldPriority);
    else container.style.removeProperty('scroll-behavior');
  }
}
