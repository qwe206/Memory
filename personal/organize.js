import { notify as toastr } from './notify.js';
import { apiProfileManager } from '../utils/config/ApiProfileManager.js';
import { extension_settings, getContext } from '/scripts/extensions.js';
import { extensionName } from '../utils/settings.js';
import { saveSettingsDebounced, eventSource, event_types } from '/script.js';
import { getTargetLorebookName, maybeTriggerAutomaticRefinement, getAvailableWorldbooks } from '../core/historiographer.js';
import { chatKey } from './recovery.js';
import { selectSummaryWorldbook } from './legacy-book.js';

/** Structure existing fields without replacing their handlers or stored values. */
export function organizeWorkspace(root) {
  const legacy = document.createElement('fieldset');
  legacy.innerHTML = '<legend>接续旧世界书</legend><label for="am-existing-summary-book">当前聊天使用的总结世界书</label><div class="am-model-field"><select id="am-existing-summary-book"></select><button type="button" class="menu_button">刷新列表</button></div><small>选中后，总结、楼层管理和归档都使用这本书。保留原书名和进度，不复制或删除内容。</small><p class="notes" role="status"></p>';
  root.querySelector('[data-page="world"] .am-route-heading').after(legacy);
  const selector = legacy.querySelector('select'), status = legacy.querySelector('[role="status"]');
  async function refreshBooks() {
    const selected = extension_settings[extensionName].historiographyWorldbookOverrides?.[chatKey(getContext())] || '';
    const option = (name, title) => { const node = document.createElement('option'); node.value = name; node.textContent = title; return node; };
    selector.replaceChildren(option('', '按原来的世界书设置'));
    for (const name of await getAvailableWorldbooks()) selector.append(option(name, name));
    if (selected && ![...selector.options].some(node => node.value === selected)) selector.append(option(selected, `${selected}（未找到，请重选）`));
    selector.value = selected;
  }
  const refresh = () => refreshBooks().catch(error => { status.textContent = error.message; });
  legacy.querySelector('button').addEventListener('click', refresh);
  eventSource.on(event_types.CHAT_CHANGED, () => { status.textContent = ''; refresh(); });
  selector.addEventListener('change', async () => {
    selector.disabled = true;
    try { await selectSummaryWorldbook(selector.value); status.textContent = selector.value ? '已接续。请点击记忆首页的刷新查看原总结。' : '已恢复原来的世界书设置。'; }
    catch (error) { status.textContent = error.message; await refresh(); }
    finally { selector.disabled = false; }
  });
  refresh();
  const largeAuto = document.createElement('fieldset');
  largeAuto.innerHTML='<legend>自动生成大总结</legend><label for="am-large-auto-every">每几次小总结生成一次大总结</label><input id="am-large-auto-every" type="number" min="0" max="500" step="1"><small>只计算已保存的小总结。0 表示关闭；生成大总结后重新计数。</small><button type="button" id="am-start-large-auto" class="menu_button">开始自动大总结</button><p role="status" class="notes"></p>';
  root.querySelector('[data-page="world"] .am-route-heading').after(largeAuto);
  const every=largeAuto.querySelector('input');every.value=extension_settings[extensionName].historiographyLargeAutoEvery ?? 0;
  every.addEventListener('change',()=>{
    const number=Number(every.value);
    if(!Number.isInteger(number)||number<0||number>500){every.value=extension_settings[extensionName].historiographyLargeAutoEvery??0;toastr.warning('请输入 0～500 的整数。');return;}
    extension_settings[extensionName].historiographyLargeAutoEvery=number;saveSettingsDebounced();
  });
  const startLarge = largeAuto.querySelector('button');
  startLarge.addEventListener('click', async () => {
    const threshold = Number(every.value);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 500) { toastr.warning('请先设置每几次小总结生成大总结（1～500）。'); return; }
    extension_settings[extensionName].historiographyLargeAutoEvery = threshold; saveSettingsDebounced();
    startLarge.disabled = true;
    largeAuto.querySelector('[role="status"]').textContent = '自动大总结已开启，正在后台检查已保存的小总结。';
    try {
      const book = await getTargetLorebookName();
      if (!book) throw new Error('请先选择当前聊天的总结世界书。');
      const saved = await maybeTriggerAutomaticRefinement(book);
      largeAuto.querySelector('[role="status"]').textContent = saved ? '本轮大总结已完成；后续达到阈值时继续自动生成。' : '自动大总结保持开启；未完成写入或未达到阈值时，保留现有内容。';
    } catch (error) { toastr.error(error.message); largeAuto.querySelector('[role="status"]').textContent = error.message; }
    finally { startLarge.disabled = false; }
  });
  const mode = document.createElement('fieldset');
  mode.innerHTML = '<legend>总结模式</legend><label class="am-summary-mode"><input id="am-summary-silent" type="checkbox">静默总结</label><small>开启后，手动、自动、批量以及大小总结均在后台生成并直接写入，只显示通知，不弹出确认窗口。</small>';
  root.querySelector('[data-page="memory"] .am-route-heading').after(mode);
  const silent = mode.querySelector('input'); silent.checked = !!extension_settings[extensionName].historiographySilent;
  silent.addEventListener('change', () => { extension_settings[extensionName].historiographySilent = silent.checked; saveSettingsDebounced(); });
  root.querySelector('#historiography_auto_summary_interactive')?.closest('.auto-control-pair')?.setAttribute('hidden','');
  const fieldset = id => root.querySelector(`#${id}`)?.closest('fieldset');
  function title(node, text) {
    const legend = node?.querySelector(':scope > legend');
    if (legend) legend.textContent = text;
  }
  function fold(node, label, help = '') {
    if (!node) return;
    const details = document.createElement('details'); details.className = 'am-settings-fold';
    const summary = document.createElement('summary'); summary.textContent = label;
    node.before(details); details.append(summary);
    if (help) { const note = document.createElement('p'); note.className = 'am-section-help'; note.textContent = help; details.append(note); }
    details.append(node); node.classList.add('am-fold-body');
  }
  // Leave detached-feature controls hidden for legacy UI bindings; no runtime ingestion remains.
  const raw = fieldset('hly-condensation-enabled');
  if (raw) { raw.hidden = true; raw.inert = true; raw.dataset.removedFeature = 'raw-chat-ingestion'; raw.querySelectorAll('input,button,textarea').forEach(n => n.disabled = true); }

  const retrieval = root.querySelector('#hly-retrieval-tab');
  const shared = root.querySelector('.hly-imperial-edict');
  if (retrieval && shared) retrieval.prepend(shared);
  title(fieldset('hly-retrieval-enabled'), '检索开关');
  const config = fieldset('hly-api-endpoint');
  fold(config, '嵌入连接与测试', '已分配方案时优先使用该方案；未分配时使用这里的配置。');
  if (config) {
    const link = document.createElement('button'); link.type = 'button'; link.textContent = '选择嵌入方案';
    link.addEventListener('click', () => root.querySelector('.am-app-sidebar [data-route="models"]')?.click());
    const hint = document.createElement('div'); hint.className = 'am-vector-setup';
    hint.innerHTML = '<strong></strong><p></p>';
    function showEmbedding() {
      const profile = apiProfileManager.getProfile(apiProfileManager.getAssignment('ragEmbed'));
      hint.querySelector('strong').textContent = profile ? `嵌入方案：${profile.name}` : '先配置嵌入模型';
      hint.querySelector('p').textContent = profile ? `模型：${profile.model || '未选择模型'}` : '新建“向量嵌入”方案，再到模型配置里分配给向量化。';
    }
    showEmbedding(); document.addEventListener('amily2:slotAssigned',showEmbedding);
    hint.append(link); shared.after(hint);
  }
  // Advanced controls remain discoverable on their existing pages, closed initially.
  const sort = root.querySelector('#hly-super-sort-enabled')?.closest('.hly-control-block');
  fold(sort, '进阶排序');
  fold(fieldset('hly-independent-chat-memory-enabled')?.querySelector('.hly-control-block:has(#hly-independent-chat-memory-enabled)'), '聊天记忆隔离', '开启后按聊天检索；已启用的全局库仍可共用。');
  for (const [id,label] of [['hly-rerank-api-mode','重排序连接'],['hly-chunk-size','分块与检索参数'],['hly-query-preprocessing-enabled','检索内容处理'],['hly-injection-source-selector','注入位置与模板'],['hly-retrieval-notify','通知'],['amily2_keystore_mode','进阶：密钥存储']]) fold(fieldset(id),label);
  const priority = root.querySelector('#hly-rerank-tab > fieldset:last-of-type');
  if (priority && !priority.closest('details')) {
    fold(priority,'进阶：按来源优先保留');
    const help = priority.querySelector(':scope > small');
    if (help) help.textContent = '勾选的来源优先保留指定块数，不参与重排序；不足时取实际数量。其余来源照常检索。';
    const names = ['小说／文档','旧聊天记录','世界书／总结','粘贴文本'];
    priority.querySelectorAll('.hly-priority-source-config > .hly-control-block').forEach((row,index)=>{
      const choice = row.querySelector('.hly-checkbox-label'), number = row.querySelector('input[type="number"]');
      choice.querySelector('span').textContent = names[index];
      const count = document.createElement('div'); count.className = 'am-priority-count';
      const label = document.createElement('label'); number.id = `am-priority-count-${index}`;label.htmlFor=number.id;label.textContent='保留块数';
      number.min='0';number.step='1';
      row.replaceChildren(choice,count); count.append(label,number);
    });
    const credit = priority.querySelector('.hly-feature-credit');
    if (credit) { credit.textContent='功能贡献：Silence_Lurker潜默';credit.classList.add('am-section-help'); }
  }
  const logs = root.querySelector('#hly-log-container');
  if (logs) { root.querySelector('#hly-advanced-tab')?.append(logs); fold(logs,'运行日志'); }
  for (const [id,label] of [['hly-manual-text','粘贴文本'],['hanlinyuan-ingest-novel-file-input','导入文本文件'],['hly-hist-select-library','导入世界书条目']]) fold(fieldset(id),label);
  const ngms = fieldset('amily2_ngms_enabled');
  title(ngms,'独立总结连接');
  const intro = ngms?.querySelector(':scope > small');
  if (intro) intro.textContent = '让总结使用单独的模型连接。';
  const stream = root.querySelector('#amily2_ngms_fakestream_enabled')?.closest('.control-group');
  fold(stream,'进阶：流式防超时');
  const ngmsConfig = root.querySelector('#amily2_ngms_config_panel');
  if (ngmsConfig) fold(ngmsConfig,'手动连接与进阶设置','使用已分配的方案时，无需重复填写。');
  title(fieldset('amily2_profile_list'),'连接方案');
  const add = root.querySelector('#amily2_add_profile');
  const filters = root.querySelector('.am-api-filters');
  if (add && filters) {
    const toolbar = document.createElement('div'); toolbar.className = 'am-connections-toolbar';
    const text = document.createElement('p'); text.textContent = '先建连接，再到“模型配置”分配用途。';
    filters.before(toolbar); toolbar.append(text,add);
    filters.setAttribute('aria-label','按模型类型筛选');
  }
  // Give each vector page a real heading; global status no longer repeats above every page.
  const headings = {retrieval:'知识库检索',historiography:'导入内容','knowledge-bases':'知识库管理',rerank:'重排序',advanced:'知识库进阶设置'};
  for (const [id,label] of Object.entries(headings)) {
    const page = root.querySelector(`#hly-${id}-tab`); if (!page) continue;
    const h = document.createElement('h2'); h.className = 'am-vector-title'; h.textContent = label; page.prepend(h);
  }
  const kbPage = root.querySelector('#hly-knowledge-bases-tab');
  const local = fieldset('hly-kb-select-all-local'), global = fieldset('hly-kb-select-all-global');
  if (kbPage && local && global) {
    kbPage.querySelector('h2').after(local);
    const character = local.querySelector('#hly-local-kb-char-name');
    local.querySelector('legend').replaceChildren(document.createTextNode('当前角色 · '),character);
    title(global,'全局共享');
    for (const [section,help] of [[local,'只供当前角色检索。'],[global,'所有角色都能检索，适合共用设定。']]) {
      const note=document.createElement('p');note.className='am-section-help';note.textContent=help;section.querySelector('legend').after(note);
    }
    root.querySelector('#hly-kb-list-local-placeholder').textContent='当前角色还没有知识库，先到“导入内容”添加。';
    root.querySelector('#hly-kb-list-global-placeholder').textContent='暂无共享知识库。可在知识库的“更多操作”中设为共享。';
    const bulk=document.createElement('div');kbPage.append(bulk);
    bulk.append(root.querySelector('.hly-kb-transfer-controls'),root.querySelector('#hly-kb-delete-local-btn').parentElement);
    fold(bulk,'批量管理','移动全部知识库或删除当前角色全部知识库。');
    root.querySelector('#hly-kb-move-all-to-local').textContent='全部共享库移到当前角色';
    root.querySelector('#hly-kb-move-all-to-global').textContent='当前角色全部设为共享';
    root.querySelector('#hly-kb-delete-local-btn').textContent='删除当前角色全部知识库';
  }
  // Existing summaries, floor retention and worldbook controls are all preserved.
  const world = root.querySelector('[data-page="world"]');
  if (world) {
    const source = fieldset('amily2_target_main'); title(source,'写入位置');
    const advanced = source?.querySelector('.grid-right-col');
    const save = source?.querySelector('#amily2_save_lore_settings')?.closest('.amily2_settings_block');
    if (save) source.append(save);
    fold(advanced,'进阶：激活与注入位置');
    const vectorToggle = world.querySelector('#amily2_vectorize_summary_content')?.closest('.auto-control-pair');
    if (vectorToggle) {
      const help = vectorToggle.nextElementSibling;
      const retry = world.querySelector('#amily2_personal_retry_history');
      const group = document.createElement('div'); vectorToggle.before(group);
      group.append(vectorToggle);
      if (help?.matches('.notes')) { help.textContent = '旧总结入库并校验成功后才移出；失败时保留原文。'; group.append(help); }
      if (retry) group.append(retry);
      fold(group,'历史总结入库');
    }
  }
  fold(fieldset('amily2_manual_hide_from'),'手动隐藏与恢复');
  const statusRows = shared?.querySelectorAll(':scope > .hly-edict-row');
  if (statusRows?.length) {
    const status = document.createElement('details'); status.className = 'am-settings-fold';
    const summary = document.createElement('summary'); summary.textContent = '状态与存储管理'; status.append(summary);
    statusRows[0].before(status); status.append(...statusRows);
  }
  for (const node of root.querySelectorAll('fieldset:not([data-removed-feature])')) node.classList.add('am-setting-card');
}
