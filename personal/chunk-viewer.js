import { getKnowledgeBaseChunks, getMemoryBindingReference, getChatMemoryBindingContext, editKnowledgeBaseChunk } from '../core/rag-processor.js';
import { openChatBindingDialog, getKnowledgeManagementContext, renderChatBindingPanel } from './chat-binding-ui.js';
import { chunkHash } from './chat-memory-bindings.js';
import { themeMemoryDialog } from './shell.js';
import { auditChunkDuplicates } from './chunk-audit.js';

export async function openChunkViewer(id, scope, name) {

  const captured = getChatMemoryBindingContext(), reference = getMemoryBindingReference(id, scope);
  const managed = getKnowledgeManagementContext();
  const dialog = document.createElement('dialog'); dialog.className = 'am-chunk-viewer';
  dialog.setAttribute('aria-label','知识库分块');
  dialog.innerHTML = '<header><div><h2>知识库分块</h2><p class="am-chunk-book"></p></div><button type="button" class="am-chunk-close">关闭</button></header><p class="am-chunk-status" role="status">正在读取实际入库内容…</p><label class="am-chunk-search-label">搜索分块<input type="search" class="am-chunk-search" placeholder="输入关键词" disabled></label><div class="am-chunk-grid"></div><footer><button type="button" class="am-chunk-prev">上一页</button><span class="am-chunk-page" aria-live="polite"></span><button type="button" class="am-chunk-next">下一页</button></footer>';
  dialog.querySelector('.am-chunk-book').textContent = name;
  document.body.append(dialog); themeMemoryDialog(dialog);
  const controller = new AbortController();
  dialog.addEventListener('close',()=>{controller.abort();dialog.remove();});
  dialog.querySelector('.am-chunk-close').addEventListener('click',()=>dialog.close());
  dialog.showModal();
  const status = dialog.querySelector('.am-chunk-status'), search = dialog.querySelector('input');
  const duplicateFilter=document.createElement('label');duplicateFilter.className='am-chunk-duplicates';
  duplicateFilter.innerHTML='<input type="checkbox"> 只看完全重复的分块';
  dialog.querySelector('.am-chunk-grid').before(duplicateFilter);
  const duplicateOnly=duplicateFilter.querySelector('input');duplicateOnly.disabled=true;
  const toolbar = document.createElement('div'); toolbar.className = 'am-chunk-selection';
  toolbar.hidden = true;
  toolbar.innerHTML = '<button type="button" class="am-chunk-select-filtered" disabled>选择全部匹配块</button><button type="button" class="am-chunk-clear-selection" disabled>清除选择</button><span class="am-chunk-selected-count" role="status">已选 0 块</span><button type="button" class="am-chunk-bind" disabled>绑定聊天</button>';
  dialog.querySelector('.am-chunk-grid').before(toolbar);
  const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'am-chunk-choose'; choose.textContent = '选择分块';
  toolbar.before(choose);
  choose.addEventListener('click', () => {
    const selecting = dialog.classList.toggle('am-selecting-chunks');
    toolbar.hidden = !selecting; choose.textContent = selecting ? '退出多选' : '选择分块';
  });
  const selected = new Set();
  const bind = toolbar.querySelector('.am-chunk-bind'), clear = toolbar.querySelector('.am-chunk-clear-selection');
  const selectFiltered = toolbar.querySelector('.am-chunk-select-filtered');
  const previous = dialog.querySelector('.am-chunk-prev'), next = dialog.querySelector('.am-chunk-next');
  previous.disabled = next.disabled = true;
  let page = 0, chunks = [], audit = auditChunkDuplicates([]);
  function filteredChunks() {
    const query = search.value.trim().toLocaleLowerCase();
    return chunks.map((chunk,index)=>({...chunk,number:index+1})).filter(chunk=>chunk.text.toLocaleLowerCase().includes(query)&&(!duplicateOnly.checked||audit.byNumber.has(chunk.number)));
  }
  function updateSelection() {
    toolbar.querySelector('.am-chunk-selected-count').textContent = `已选 ${selected.size} 块`;
    bind.disabled = clear.disabled = !selected.size;
  }
  selectFiltered.addEventListener('click', () => {
    for (const chunk of filteredChunks()) { const hash = chunkHash(chunk.hash); if (hash !== null) selected.add(hash); }
    render();
  });
  clear.addEventListener('click', () => { selected.clear(); render(); });
  bind.addEventListener('click', () => {
    const live = getChatMemoryBindingContext();
    if (captured.owner !== live.owner || captured.chatId !== live.chatId) { status.textContent = '聊天已切换，请重新打开分块查看。'; return; }
    openChatBindingDialog([{ ...reference, hashes: [...selected] }]);
  });
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = filteredChunks();
    const pages = Math.max(1,Math.ceil(filtered.length/12)); page = Math.min(page,pages-1);
    const output = dialog.querySelector('.am-chunk-grid'); output.replaceChildren();
    for (const chunk of filtered.slice(page*12,page*12+12)) {
      const details = document.createElement('details'); details.className = 'am-chunk-card';
      const summary = document.createElement('summary'); summary.textContent = `块 ${chunk.number} · ${Array.from(chunk.text).length} 字符`;
      const group=audit.byNumber.get(chunk.number);
      if(group){const badge=document.createElement('span');badge.className='am-chunk-duplicate-note';badge.textContent=`相同内容共 ${group.length} 份 · 块 ${group.slice(0,8).join('、')}${group.length>8?'…':''}`;summary.append(badge);}
      const preview = document.createElement('span'); preview.className = 'am-chunk-preview'; preview.textContent = chunk.text.replace(/<[^>]*>/g,'').trim().slice(0,100);
      const full = document.createElement('pre'); full.textContent = chunk.text;
      summary.append(preview); details.append(summary,full);
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'am-chunk-edit'; edit.textContent = '编辑分块';
      const bound = getChatMemoryBindingContext(managed.chatId).references.find(ref => ref.collectionId === reference.collectionId);
      edit.disabled = !bound || (bound.hashes !== null && !bound.hashes.map(String).includes(String(chunk.hash)));
      edit.title = edit.disabled ? '此分块未绑定到所选聊天，可先绑定后编辑' : '修改当前剧情使用的副本，保留归档原文';
      edit.addEventListener('click', () => {
        if (details.querySelector('textarea')) return;
        const editor = document.createElement('textarea'); editor.value = chunk.text; editor.setAttribute('aria-label', `编辑块 ${chunk.number}`);
        const actions = document.createElement('div'); actions.className = 'am-chunk-edit-actions';
        const save = document.createElement('button'); save.type = 'button'; save.textContent = '保存分块';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消编辑';
        cancel.addEventListener('click', () => { editor.remove(); actions.remove(); full.hidden = false; edit.hidden = false; });
        save.addEventListener('click', async () => {
          save.disabled = cancel.disabled = true;
          try {
            if (getKnowledgeManagementContext().owner !== managed.owner || getKnowledgeManagementContext().chatId !== managed.chatId) throw new Error('管理文件已切换，请重新打开。');
            const updated = await editKnowledgeBaseChunk(id, scope, chunk.hash, chunk.text, editor.value, managed.chatId, controller.signal);
            renderChatBindingPanel(); window.updateHLYMemoryCount?.();
            dialog.close(); await openChunkViewer(updated.id, updated.scope, updated.name);
          } catch (error) { status.textContent = error.message; save.disabled = cancel.disabled = false; }
        });
        actions.append(save,cancel); full.hidden = true; edit.hidden = true; details.open = true; details.append(editor,actions); editor.focus();
      });
      details.append(edit);
      const row = document.createElement('div'); row.className = 'am-chunk-selectable';
      const label = document.createElement('label'); label.className = 'am-chunk-choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      const hash = chunkHash(chunk.hash); checkbox.disabled = hash === null; checkbox.checked = selected.has(hash);
      checkbox.setAttribute('aria-label', `选择块 ${chunk.number}`);
      checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(hash) : selected.delete(hash); updateSelection(); });
      label.append(checkbox); row.append(label,details); output.append(row);
    }
    if (!filtered.length) { const empty=document.createElement('p');empty.textContent=query||duplicateOnly.checked?'没有匹配的分块。':'这个知识库还没有分块。';output.append(empty); }
    previous.disabled = page===0; next.disabled = page>=pages-1;
    dialog.querySelector('.am-chunk-page').textContent = `${page+1} / ${pages} 页 · ${filtered.length} 块`;
    selectFiltered.disabled = !filtered.some(chunk => chunkHash(chunk.hash) !== null);
    updateSelection();
  }
  search.addEventListener('input',()=>{page=0;render();});
  duplicateOnly.addEventListener('change',()=>{page=0;render();});
  previous.addEventListener('click',()=>{page--;render();}); next.addEventListener('click',()=>{page++;render();});
  try {
    const result = await getKnowledgeBaseChunks(id,scope,controller.signal);
    if (!dialog.isConnected) return;
    chunks=result.chunks;
    audit=auditChunkDuplicates(chunks);duplicateOnly.disabled=false;
    const duplicateSummary=`${audit.unique} 份不同内容，${audit.extra} 条完全重复。重复检查不删除原文；编辑另存剧情副本。`;
    status.textContent = result.complete ? `已读取全部 ${result.total} 块。${duplicateSummary}` : `仅返回 ${chunks.length} / ${result.total} 块，内容可能不完整。已读内容中：${duplicateSummary}`;
    search.disabled=false;render();
  } catch(error) {
    if (dialog.isConnected) status.textContent=`${error.message} 查看需要嵌入连接可用，不会改动原数据。`;
  }
}
