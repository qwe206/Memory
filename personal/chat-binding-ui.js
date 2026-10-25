import * as Memory from '../core/rag-processor.js';
import { getChatId } from '../core/utils/context-utils.js';
import { themeMemoryDialog } from './shell.js';
import { pluginAuthStatus } from '../utils/auth.js';
import { notify } from './notify.js';

const button = (text, action) => {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
  element.addEventListener('click', action); return element;
};

export function renderChatBindingPanel() {
  const page = document.querySelector('#hly-knowledge-bases-tab');
  if (!page) return;
  let panel = page.querySelector('.am-chat-bindings');
  if (!panel) {
    panel = document.createElement('fieldset'); panel.className = 'hly-settings-group am-chat-bindings';
    const legend = document.createElement('legend'); legend.textContent = '聊天记忆绑定';
    panel.innerHTML = '<label class="am-binding-switch"><input type="checkbox"> 仅检索当前聊天绑定的记忆</label><p class="am-section-help">开启后，新聊天从空白记忆开始；局部库、全局库和优先检索都遵守绑定。在本聊天中新入库的记忆会自动绑定。关闭后恢复原有检索范围，不删除向量。</p><p class="am-binding-current"></p><div class="am-binding-list"></div><p class="am-section-help">在下方多选知识库后点击“绑定聊天”；只选部分内容，请进入“查看分块”。</p>';
    panel.prepend(legend); page.prepend(panel);
    panel.querySelector('input').addEventListener('change', event => {
      if (!pluginAuthStatus.authorized) return;
      Memory.getSettings().chatMemoryBindings.enabled = event.target.checked;
      Memory.saveSettings(); renderChatBindingPanel();
    });
    panel.append(button('清空当前聊天的绑定', () => {
      const current = Memory.getChatMemoryBindingContext();
      if (!pluginAuthStatus.authorized || !current.chatId || !current.owner) return;
      Memory.clearChatMemoryBindings(current.owner, current.chatId); renderChatBindingPanel();
      notify.success('已解除当前聊天的全部绑定，原向量数据保留。');
    }));
    const ctx = SillyTavern.getContext();
    const changed = () => { if (panel.isConnected) renderChatBindingPanel(); };
    ctx.eventSource?.on(ctx.eventTypes?.CHAT_CHANGED || 'chat_id_changed', changed);
  }
  const current = Memory.getChatMemoryBindingContext();
  const heading = page.querySelector(':scope > .am-vector-title');
  if (heading) heading.after(panel);
  panel.querySelector('input').checked = current.enabled;
  panel.querySelector('.am-binding-current').textContent = current.chatId ? `当前聊天：${current.chatId}` : '请先打开一个聊天。';
  const list = panel.querySelector('.am-binding-list'); list.replaceChildren();
  for (const ref of current.references) {
    const row = document.createElement('div'); row.className = 'am-binding-row';
    const name = document.createElement('span'); name.textContent = `${ref.name} · ${ref.hashes === null ? '整个知识库' : `${ref.hashes.length} 个分块`}`;
    row.append(name, button('解除绑定', () => {
      if (!pluginAuthStatus.authorized) return;
      try {
        Memory.saveChatMemoryBindings(current.owner, [current.chatId], [{ ...ref, hashes: null }], true);
        renderChatBindingPanel();
      } catch (error) { notify.warning(error.message); }
    })); list.append(row);
  }
  if (!current.references.length) list.textContent = current.enabled ? '尚未绑定记忆，本聊天不会检索旧知识库。' : '尚未绑定记忆，当前仍使用原有检索范围。';
  panel.lastElementChild.disabled = !current.owner || !current.chatId || !current.references.length;
}

/** Uses ST's chat-file search API; it reads names, never chat contents. */
export async function listBindingChats(context, currentChatId, signal) {
  const character = context.characters?.[context.characterId];
  if (context.groupId == null && !character?.avatar) throw new Error('请先打开角色聊天。');
  const response = await fetch('/api/chats/search', {
    method: 'POST', headers: context.getRequestHeaders(), signal,
    body: JSON.stringify({ query: '', avatar_url: context.groupId != null ? null : character.avatar, group_id: context.groupId ?? null }),
  });
  if (!response.ok) throw new Error(`读取聊天文件失败（HTTP ${response.status}），请重试。`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('聊天文件列表格式不正确，请重试。');
  return [...new Set([currentChatId, ...data.map(chat => chat.file_name)].filter(name => typeof name === 'string' && name))];
}

export async function openChatBindingDialog(references) {
  if (!pluginAuthStatus.authorized || !references.length) return;
  const captured = Memory.getChatMemoryBindingContext(), context = SillyTavern.getContext();
  if (!captured.owner || !captured.chatId) { notify.warning('请先打开一个聊天。'); return; }
  const dialog = document.createElement('dialog'); dialog.className = 'am-chunk-viewer am-chat-binding-dialog';
  dialog.setAttribute('aria-label', '绑定聊天文件');
  dialog.innerHTML = '<header><h2>绑定聊天文件</h2><button type="button" class="am-binding-close">取消</button></header><p class="am-binding-selection"></p><p class="am-section-help">可选择多个聊天。绑定会合并到各聊天已有的选择；解除绑定只影响本次选择，向量原文保留。</p><label class="am-chunk-search-label">搜索聊天文件<input type="search" placeholder="输入聊天文件名称"></label><p class="am-binding-status" role="status">正在读取聊天文件…</p><div class="am-binding-chat-list"></div><label class="am-binding-switch"><input type="checkbox" class="am-binding-enable"> 启用按聊天绑定（新聊天不会读取未绑定的旧记忆）</label><footer><button type="button" class="am-binding-remove" disabled>解除所选绑定</button><button type="button" class="am-binding-save" disabled>绑定到所选聊天</button></footer>';
  dialog.querySelector('.am-binding-selection').textContent = `已选 ${references.length} 个知识库 · ${references.some(ref => ref.hashes === null) ? '包含整库绑定' : references.reduce((n, ref) => n + ref.hashes.length, 0) + ' 个分块'}`;
  dialog.querySelector('.am-binding-enable').checked = captured.enabled;
  document.body.append(dialog); themeMemoryDialog(dialog);
  const controller = new AbortController();
  dialog.addEventListener('close', () => { controller.abort(); dialog.remove(); });
  dialog.querySelector('.am-binding-close').addEventListener('click', () => dialog.close());
  dialog.showModal();
  const selected = new Set([captured.chatId]), status = dialog.querySelector('.am-binding-status');
  const save = dialog.querySelector('.am-binding-save'), remove = dialog.querySelector('.am-binding-remove');
  const search = dialog.querySelector('input[type="search"]');
  let chats = [];
  function valid() {
    const live = Memory.getChatMemoryBindingContext();
    if (!pluginAuthStatus.authorized || live.owner !== captured.owner || getChatId() !== captured.chatId) {
      throw new Error('聊天已切换，请关闭后重新打开绑定设置。');
    }
  }
  function render() {
    const list = dialog.querySelector('.am-binding-chat-list'); list.replaceChildren();
    const filtered = chats.filter(name => name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    for (const name of filtered) {
      const row = document.createElement('label'); row.className = 'am-binding-chat';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(name);
      const text = document.createElement('span'); text.textContent = `${name}${name === captured.chatId ? '（当前）' : ''}`;
      input.addEventListener('change', () => { input.checked ? selected.add(name) : selected.delete(name); updateCount(); });
      row.append(input, text); list.append(row);
    }
    if (!filtered.length) list.textContent = '没有匹配的聊天文件。';
    updateCount();
  }
  function updateCount() {
    status.textContent = `${chats.length} 个聊天文件 · 已选 ${selected.size} 个`;
    save.disabled = remove.disabled = !selected.size;
  }
  for (const [element, unbind] of [[save, false], [remove, true]]) element.addEventListener('click', () => {
    try {
      valid();
      Memory.saveChatMemoryBindings(captured.owner, [...selected], references, unbind);
      if (!unbind && dialog.querySelector('.am-binding-enable').checked) {
        Memory.getSettings().chatMemoryBindings.enabled = true; Memory.saveSettings();
      }
      renderChatBindingPanel(); dialog.close();
      notify.success(`已${unbind ? '解除' : '保存'} ${selected.size} 个聊天的记忆绑定。`);
    } catch (error) { status.textContent = error.message; }
  });
  search.addEventListener('input', render);
  try {
    chats = await listBindingChats(context, captured.chatId, controller.signal);
    if (!dialog.isConnected) return;
    valid(); render();
  } catch (error) {
    if (dialog.isConnected) {
      status.textContent = error.message;
      const retry = button('重新读取聊天文件', () => { dialog.close(); openChatBindingDialog(references); });
      status.after(retry);
    }
  }
}
