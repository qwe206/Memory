import { getKnowledgeBaseChunks } from '../core/rag-processor.js';
import { themeMemoryDialog } from './shell.js';
import { pluginAuthStatus } from '../utils/auth.js';
import { auditChunkDuplicates } from './chunk-audit.js';

export async function openChunkViewer(id, scope, name) {
  if (!pluginAuthStatus.authorized) return;
  const dialog = document.createElement('dialog'); dialog.className = 'am-chunk-viewer';
  dialog.setAttribute('aria-label','知识库分块');
  dialog.innerHTML = '<header><div><h2>知识库分块</h2><p class="am-chunk-book"></p></div><button type="button" class="am-chunk-close">关闭</button></header><p class="am-chunk-status" role="status">正在读取实际入库内容…</p><label class="am-chunk-search-label">搜索分块<input type="search" class="am-chunk-search" placeholder="输入关键词" disabled></label><div class="am-chunk-grid"></div><footer><button type="button" class="am-chunk-prev">上一页</button><span class="am-chunk-page" aria-live="polite"></span><button type="button" class="am-chunk-next">下一页</button></footer>';
  dialog.querySelector('.am-chunk-book').textContent = name;
  document.body.append(dialog); themeMemoryDialog(dialog);
  const controller = new AbortController();
  const root = document.querySelector('#amily2_chat_optimiser');
  const authorization = new MutationObserver(()=>{if(!pluginAuthStatus.authorized)dialog.close();});
  if(root)authorization.observe(root,{attributes:true,attributeFilter:['class']});
  dialog.addEventListener('close',()=>{controller.abort();authorization.disconnect();dialog.remove();});
  dialog.querySelector('.am-chunk-close').addEventListener('click',()=>dialog.close());
  dialog.showModal();
  const status = dialog.querySelector('.am-chunk-status'), search = dialog.querySelector('input');
  const duplicateFilter=document.createElement('label');duplicateFilter.className='am-chunk-duplicates';
  duplicateFilter.innerHTML='<input type="checkbox"> 只看完全重复的分块';
  dialog.querySelector('.am-chunk-grid').before(duplicateFilter);
  const duplicateOnly=duplicateFilter.querySelector('input');duplicateOnly.disabled=true;
  const previous = dialog.querySelector('.am-chunk-prev'), next = dialog.querySelector('.am-chunk-next');
  previous.disabled = next.disabled = true;
  let page = 0, chunks = [], audit = auditChunkDuplicates([]);
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = chunks.map((chunk,index)=>({...chunk,number:index+1})).filter(chunk=>chunk.text.toLocaleLowerCase().includes(query)&&(!duplicateOnly.checked||audit.byNumber.has(chunk.number)));
    const pages = Math.max(1,Math.ceil(filtered.length/12)); page = Math.min(page,pages-1);
    const output = dialog.querySelector('.am-chunk-grid'); output.replaceChildren();
    for (const chunk of filtered.slice(page*12,page*12+12)) {
      const details = document.createElement('details'); details.className = 'am-chunk-card';
      const summary = document.createElement('summary'); summary.textContent = `块 ${chunk.number} · ${Array.from(chunk.text).length} 字符`;
      const group=audit.byNumber.get(chunk.number);
      if(group){const badge=document.createElement('span');badge.className='am-chunk-duplicate-note';badge.textContent=`相同内容共 ${group.length} 份 · 块 ${group.slice(0,8).join('、')}${group.length>8?'…':''}`;summary.append(badge);}
      const preview = document.createElement('span'); preview.className = 'am-chunk-preview'; preview.textContent = chunk.text.replace(/<[^>]*>/g,'').trim().slice(0,100);
      const full = document.createElement('pre'); full.textContent = chunk.text;
      summary.append(preview); details.append(summary,full); output.append(details);
    }
    if (!filtered.length) { const empty=document.createElement('p');empty.textContent=query||duplicateOnly.checked?'没有匹配的分块。':'这个知识库还没有分块。';output.append(empty); }
    previous.disabled = page===0; next.disabled = page>=pages-1;
    dialog.querySelector('.am-chunk-page').textContent = `${page+1} / ${pages} 页 · ${filtered.length} 块`;
  }
  search.addEventListener('input',()=>{page=0;render();});
  duplicateOnly.addEventListener('change',()=>{page=0;render();});
  previous.addEventListener('click',()=>{page--;render();}); next.addEventListener('click',()=>{page++;render();});
  try {
    const result = await getKnowledgeBaseChunks(id,scope,controller.signal);
    if (!dialog.isConnected || !pluginAuthStatus.authorized) return;
    chunks=result.chunks;
    audit=auditChunkDuplicates(chunks);duplicateOnly.disabled=false;
    const duplicateSummary=`${audit.unique} 份不同内容，${audit.extra} 条完全重复。这里只检查，不删除。`;
    status.textContent = result.complete ? `已读取全部 ${result.total} 块。${duplicateSummary}` : `仅返回 ${chunks.length} / ${result.total} 块，内容可能不完整。已读内容中：${duplicateSummary}`;
    search.disabled=false;render();
  } catch(error) {
    if (dialog.isConnected) status.textContent=`${error.message} 查看需要嵌入连接可用，不会改动原数据。`;
  }
}
