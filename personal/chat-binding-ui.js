import * as Memory from '../core/rag-processor.js';
import { getChatId } from '../core/utils/context-utils.js';
import { themeMemoryDialog } from './shell.js';
import { pluginAuthStatus } from '../utils/auth.js';
import { notify } from './notify.js';

const button = (text, action) => {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
  element.addEventListener('click', action); return element;
};

let managedOwner, actualChat, managedChat, chatListKey, chatRequest = 0;
let refreshKnowledgeView = () => {};
export function setKnowledgeViewRefresh(callback) { refreshKnowledgeView = callback; }

export function getKnowledgeManagementContext() {
  const current = Memory.getChatMemoryBindingContext();
  if (managedOwner !== current.owner || actualChat !== current.chatId) {
    managedOwner = current.owner; actualChat = current.chatId; managedChat = current.chatId;
  }
  return { ...Memory.getChatMemoryBindingContext(managedChat), actualChatId: actualChat };
}

function foldManagementControls(page) {
  page.classList.remove('am-binding-picking');
  const picker = page.querySelector('.am-binding-picker'); if (picker) picker.hidden = true;
  const pick = page.querySelector('.am-binding-pick'); if (pick) pick.textContent = '选择记忆';
  for (const input of page.querySelectorAll('.hly-kb-item-checkbox:checked')) {
    input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  for (const details of page.querySelectorAll('.am-binding-details,.am-kb-inactive')) details.open = false;
}

async function refreshManagementChats(panel, force = false) {
  const view = getKnowledgeManagementContext(), key = JSON.stringify([view.owner, view.actualChatId]);
  if (!force && chatListKey === key) return;
  chatListKey = key;
  const token = ++chatRequest, select = panel.querySelector('.am-management-chat-select');
  const status = panel.querySelector('.am-management-chat-status'), refresh = panel.querySelector('.am-management-chat-refresh');
  status.textContent = '正在读取聊天文件…'; refresh.disabled = true;
  try {
    const chats = await listBindingChats(SillyTavern.getContext(), view.actualChatId);
    const live = getKnowledgeManagementContext();
    if (!panel.isConnected || token !== chatRequest || live.owner !== view.owner || live.actualChatId !== view.actualChatId) return;
    select.replaceChildren();
    for (const name of [...new Set([live.chatId, ...chats].filter(Boolean))]) {
      const option = document.createElement('option'); option.value = name;
      option.textContent = name + (name === live.actualChatId ? '（当前打开）' : ''); select.append(option);
    }
    select.value = live.chatId; status.textContent = '';
  } catch (error) {
    if (token === chatRequest) status.textContent = `${error.message} 可点击“刷新”重试。`;
  } finally { if (token === chatRequest) refresh.disabled = false; }
}

export function renderChatBindingPanel() {
  const page = document.querySelector('#hly-knowledge-bases-tab');
  if (!page) return;
  let panel = page.querySelector('.am-chat-bindings');
  if (!panel) {
    panel = document.createElement('fieldset'); panel.className = 'hly-settings-group am-chat-bindings';
    const legend = document.createElement('legend'); legend.textContent = '聊天记忆绑定';
    panel.innerHTML = '<div class="am-binding-overview"><div><p class="am-binding-current"></p><p class="am-binding-count"></p></div><button type="button" class="am-binding-pick">选择记忆</button></div><p class="am-section-help">归档前换聊天会自动接续当前剧情；归档后新聊天从空白开始。仍可按文件查看、绑定和编辑分块。</p><div class="am-binding-picker" hidden><p class="am-section-help">在下方勾选知识库，可同时选择局部库和全局库。只要部分内容，请进入“查看分块”。</p><button type="button" class="am-binding-pick-save" disabled>绑定所选知识库</button><span class="am-binding-picked-count" role="status"></span></div><details class="am-binding-details"><summary>管理已绑定记忆</summary><div class="am-binding-list"></div><button type="button" class="am-binding-clear">解除当前聊天的全部绑定</button></details>';
    panel.prepend(legend); page.prepend(panel);
    const chooser = document.createElement('div'); chooser.className = 'am-management-chat';
    chooser.innerHTML = '<label for="am-management-chat-select">选择聊天文件</label><div class="am-management-chat-field"><select id="am-management-chat-select" class="am-management-chat-select"></select><button type="button" class="am-management-chat-refresh">刷新</button></div><p class="am-management-chat-status am-section-help" role="status"></p>';
    legend.after(chooser);
    chooser.querySelector('select').addEventListener('change', event => {
      managedChat = event.target.value; foldManagementControls(page);
      renderChatBindingPanel(); refreshKnowledgeView();
    });
    chooser.querySelector('button').addEventListener('click', () => refreshManagementChats(panel, true));
    panel.querySelector('.am-binding-pick').addEventListener('click', () => {
      const picking = page.classList.toggle('am-binding-picking');
      panel.querySelector('.am-binding-picker').hidden = !picking;
      panel.querySelector('.am-binding-pick').textContent = picking ? '完成选择' : '选择记忆';
      updatePickedCount();
    });
    const selectedReferences = () => [...page.querySelectorAll('.hly-kb-item-checkbox:checked')].map(input => {
      const row = input.closest('.hly-kb-list-item');
      return Memory.getMemoryBindingReference(row.dataset.kbId, row.dataset.kbScope);
    });
    function updatePickedCount() {
      const count = page.querySelectorAll('.hly-kb-item-checkbox:checked').length;
      panel.querySelector('.am-binding-picked-count').textContent = '已选 ' + count + ' 个知识库';
      panel.querySelector('.am-binding-pick-save').disabled = !count;
    }
    page.addEventListener('change', updatePickedCount);
    panel.querySelector('.am-binding-pick-save').addEventListener('click', () => {
      try { openChatBindingDialog(selectedReferences()); } catch (error) { notify.warning(error.message); }
    });
    panel.querySelector('.am-binding-clear').addEventListener('click', () => {
      const current = getKnowledgeManagementContext();
      if (!pluginAuthStatus.authorized || !current.chatId || !current.owner) return;
      Memory.clearChatMemoryBindings(current.owner, current.chatId); renderChatBindingPanel(); refreshKnowledgeView();
      notify.success('已解除所选聊天的全部绑定，原向量数据保留。');
    });
    const ctx = SillyTavern.getContext();
    const changed = () => { if (panel.isConnected) { renderChatBindingPanel(); refreshKnowledgeView(); } };
    ctx.eventSource?.on(ctx.eventTypes?.CHAT_CHANGED || 'chat_id_changed', changed);
  }
  const current = getKnowledgeManagementContext();
  const viewKey = JSON.stringify([current.owner, current.actualChatId, current.chatId]);
  if (panel.dataset.viewKey !== viewKey) { foldManagementControls(page); panel.dataset.viewKey = viewKey; }
  const selector = panel.querySelector('.am-management-chat-select');
  if (![...selector.options].some(option => option.value === current.chatId)) {
    const option = document.createElement('option'); option.value = current.chatId || ''; option.textContent = current.chatId || '请先打开聊天'; selector.replaceChildren(option);
  }
  selector.value = current.chatId || ''; selector.disabled = !current.owner || !current.chatId;
  if (current.owner && current.actualChatId) refreshManagementChats(panel);
  const heading = page.querySelector(':scope > .am-vector-title');
  if (heading) heading.after(panel);
  const pausedCount = current.references.filter(ref => ref.enabled === false).length;
  panel.querySelector('.am-binding-count').textContent = current.references.length
    ? '已绑定 ' + current.references.length + ' 个知识库 · ' + (pausedCount ? pausedCount + ' 个在此聊天停用' : '自动生效') : '尚未绑定记忆';
  panel.querySelector('.am-binding-pick').disabled = !current.owner || !current.chatId;
  const storyline = Memory.getMemoryStoryContext().story;
  panel.querySelector('.am-binding-current').textContent = current.chatId === current.actualChatId
    ? (storyline?.archived ? '当前剧情已归档，下个新聊天从空白开始' : '当前剧情：未归档时，新聊天自动接续总结和记忆')
    : '仅切换管理视图，实际聊天未改变';
  panel.querySelector('.am-binding-clear').textContent = '解除所选聊天的全部绑定';
  const list = panel.querySelector('.am-binding-list'); list.replaceChildren();
  for (const ref of current.references) {
    const row = document.createElement('div'); row.className = 'am-binding-row';
    const name = document.createElement('span'); name.textContent = `${ref.name} · ${ref.hashes === null ? '整个知识库' : `${ref.hashes.length} 个分块`}${ref.enabled === false ? ' · 此聊天已停用' : ''}`;
    row.append(name, button('解除绑定', () => {
      if (!pluginAuthStatus.authorized) return;
      try {
        Memory.saveChatMemoryBindings(current.owner, [current.chatId], [{ ...ref, hashes: null }], true);
        renderChatBindingPanel(); refreshKnowledgeView();
      } catch (error) { notify.warning(error.message); }
    })); list.append(row);
  }
  if (!current.references.length) list.textContent = '本聊天不会检索旧知识库。点击“选择记忆”添加需要的内容。';
  panel.querySelector('.am-binding-clear').disabled = !current.owner || !current.chatId || !current.references.length;
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
  dialog.innerHTML = '<header><h2>绑定聊天文件</h2><button type="button" class="am-binding-close">取消</button></header><p class="am-binding-selection"></p><p class="am-section-help">可选择多个聊天。绑定会合并到各聊天已有的选择；解除绑定只影响本次选择，向量原文保留。</p><label class="am-chunk-search-label">搜索聊天文件<input type="search" placeholder="输入聊天文件名称"></label><p class="am-binding-status" role="status">正在读取聊天文件…</p><div class="am-binding-chat-list"></div><footer><button type="button" class="am-binding-remove" disabled>解除所选绑定</button><button type="button" class="am-binding-save" disabled>绑定到所选聊天</button></footer>';
  dialog.querySelector('.am-binding-selection').textContent = `已选 ${references.length} 个知识库 · ${references.some(ref => ref.hashes === null) ? '包含整库绑定' : references.reduce((n, ref) => n + ref.hashes.length, 0) + ' 个分块'}`;
  document.body.append(dialog); themeMemoryDialog(dialog);
  const controller = new AbortController();
  dialog.addEventListener('close', () => { controller.abort(); dialog.remove(); });
  dialog.querySelector('.am-binding-close').addEventListener('click', () => dialog.close());
  dialog.showModal();
  const selected = new Set([getKnowledgeManagementContext().chatId || captured.chatId]), status = dialog.querySelector('.am-binding-status');
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
      const page = document.querySelector('#hly-knowledge-bases-tab');
      if (page?.classList.contains('am-binding-picking')) {
        page.classList.remove('am-binding-picking');
        page.querySelector('.am-binding-picker').hidden = true;
        page.querySelector('.am-binding-pick').textContent = '选择记忆';
        for (const input of page.querySelectorAll('.hly-kb-item-checkbox:checked')) {
          input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      renderChatBindingPanel(); refreshKnowledgeView(); dialog.close();
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
