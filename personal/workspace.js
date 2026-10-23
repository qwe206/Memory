import { findActiveSummary } from './names.js';
import { pluginAuthStatus } from '../utils/auth.js';
import { extension_settings, getContext } from '/scripts/extensions.js';
import { loadWorldInfo } from '/scripts/world-info.js';
import { extensionName } from '../utils/settings.js';
import { getTargetLorebookName } from '../core/historiographer.js';
import { parseLedgerForRefinement } from './ledger.js';
import { icon } from './icons.js';
import { organizeWorkspace } from './organize.js';

let workspace;
export function openMemoryWorkspace() { workspace?.open(); }

/** Reparent existing controls inside their original module, retaining delegated handlers. */
export function mountWorkspace(root) {
  if (workspace) return workspace;
  const originalControls = [...root.querySelectorAll('input,select,textarea,button')];
  const labels = {
    amily2_auto_hide_threshold: '上下文保留数：', historiography_retention_count: '总结保留数',
    amily2_mhb_small_trigger_count: '每次总结楼层数', historiography_max_retries: '失败重试次数',
    historiography_auto_summary_interactive: '预览后写入', amily2_ngms_enabled: '启用独立总结 API',
    amily2_ngms_fakestream_enabled: '流式防超时',
  };
  for (const [id, value] of Object.entries(labels)) {
    const label = root.querySelector(`label[for="${id}"]`);
    const text = label && [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (text) text.textContent = value;
  }
  const plainButtons = { amily2_mhb_small_manual_execute: '手动小总结', amily2_mhb_small_expedition_execute: '批量总结', amily2_mhb_archive_current: '归档当前总结并停用', amily2_mhb_restore_archive: '恢复选中归档', amily2_unhide_all_button: '恢复全部楼层' };
  for (const [id, label] of Object.entries(plainButtons)) {
    const button = root.querySelector(`#${id}`); if (button) button.textContent = label;
  }
  const dialog = document.createElement('dialog');
  dialog.id = 'am-memory-app';
  dialog.setAttribute('aria-label', 'Memory');
  document.body.append(dialog);
  dialog.append(root);
  root.classList.add('am-workspace');
  const head = document.createElement('header');
  head.className = 'am-app-header';
  head.innerHTML = `<button type="button" class="am-menu-toggle" aria-label="打开菜单" title="菜单" aria-controls="am-app-sidebar" aria-expanded="false">${icon('menu')}</button><h1>记忆管理</h1><button type="button" class="am-app-exit">${icon('exit')}<span>退出</span></button>`;
  const sidebar = document.createElement('aside');
  sidebar.id = 'am-app-sidebar'; sidebar.className = 'am-app-sidebar';
  sidebar.innerHTML = `<div class="am-sidebar-head"><strong>Memory</strong><button type="button" class="am-menu-close" aria-label="收起菜单" title="收起菜单">${icon('close')}</button></div><nav aria-label="聊天记忆导航"></nav><div class="am-sidebar-foot"></div>`;
  const backdrop = document.createElement('button');
  backdrop.type = 'button'; backdrop.className = 'am-sidebar-backdrop'; backdrop.setAttribute('aria-label', '收起菜单'); backdrop.tabIndex = -1;
  const content = document.createElement('main');
  content.className = 'am-work-content'; content.tabIndex = -1;
  content.append(...root.childNodes);
  root.append(head, content, backdrop, sidebar);
  const modules = {
    memory: root.querySelector('#amily2_additional_features_panel'),
    kb: root.querySelector('#amily2_hanlinyuan_panel'),
    api: root.querySelector('#amily2_api_config_panel'),
    about: root.querySelector('.plugin-features'),
  };
  const pages = new Map();
  const pane = (id, title, module, description = '') => {
    const element = document.createElement('section');
    element.className = 'am-route-pane'; element.dataset.page = id; element.hidden = true;
    const heading = document.createElement('div'); heading.className = 'am-route-heading';
    const h = document.createElement('h2'); h.textContent = title; heading.append(h);
    if (description) { const p = document.createElement('p'); p.textContent = description; heading.append(p); }
    element.append(heading); modules[module].append(element);
    pages.set(id, { element, title, module }); return element;
  };
  const move = (parent, ...nodes) => nodes.filter(Boolean).forEach(node => parent.append(node));
  const fieldset = id => root.querySelector(`#${id}`)?.closest('fieldset');
  const home = pane('memory', '记忆管理', 'memory');
  home.classList.add('am-memory-home');
  const floors = pane('floors', '楼层管理', 'memory', '隐藏和总结的保留数分别设置。');
  const automatic = pane('automatic', '自动与批量总结', 'memory');
  const prompts = pane('prompts', '提示词与内容处理', 'memory');
  const world = pane('world', '大总结与世界书', 'memory');
  const archives = pane('archives', '归档与备份', 'memory');
  const independent = pane('independent', '独立总结 API', 'memory');
  const small = fieldset('amily2_mhb_small_editor');
  const large = fieldset('amily2_mhb_large_editor');
  move(floors, fieldset('amily2_auto_hide_enabled'), fieldset('amily2_manual_hide_from'));
  move(world, fieldset('amily2_target_main'));
  move(independent, fieldset('amily2_ngms_enabled'));
  move(archives, fieldset('amily2_mhb_archive_current'), root.querySelector('#amily2_personal_export_backups'));
  for (const type of ['small', 'large']) {
    const section = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = type === 'small' ? '小总结提示词' : '大总结提示词'; section.append(legend);
    move(section, root.querySelector(`#amily2_mhb_${type}_prompt_selector`)?.closest('.amily2_settings_block'), root.querySelector(`#amily2_mhb_${type}_editor`)?.closest('.amily2_settings_block'));
    prompts.append(section);
  }
  const auto = root.querySelector('#amily2_mhb_auto_command_block');
  const autoHelp = auto?.nextElementSibling;
  move(automatic, auto);
  if (autoHelp?.matches('small')) { autoHelp.textContent = '批量总结会立即处理尚未总结的历史。'; automatic.append(autoHelp); }
  move(automatic, root.querySelector('#historiography_auto_summary_interactive')?.closest('.auto-control-pair'));
  move(prompts, root.querySelector('#historiography-tag-extraction-toggle')?.closest('.hly-control-block'), root.querySelector('#historiography-tag-input-container'), root.querySelector('#historiography-exclusion-rules-btn'));
  const grid = document.createElement('div'); grid.className = 'am-home-grid'; home.append(grid);
  small?.classList.add('am-summary-card'); move(grid, small);
  if (small) {
    small.querySelector(':scope > legend').textContent = '生成小总结';
    const status = document.createElement('p'); status.className = 'am-retention-note';
    small.querySelector('legend').after(status);
    const rangeLabel = small.querySelector('.manual-command-block > label');
    if (rangeLabel) rangeLabel.textContent = '总结范围';
    for (const [id, title] of [['amily2_mhb_small_start_floor', '起始楼层'], ['amily2_mhb_small_end_floor', '结束楼层']]) {
      const input = root.querySelector(`#${id}`);
      if (!input) continue;
      const field = document.createElement('div'); field.className = 'am-range-field';
      const label = document.createElement('label'); label.htmlFor = id; label.textContent = title;
      input.before(field); field.append(label, input);
    }
  }
  move(world, large);
  const saved = document.createElement('section'); saved.className = 'am-saved-memory';
  saved.innerHTML = '<div class="am-saved-head"><h3>已保存的总结</h3><button type="button" class="am-refresh-memory">刷新</button></div><p class="am-memory-status" role="status"></p><div class="am-memory-entries"></div><div class="am-quick-links"></div>';
  grid.append(saved);
  const slots = pane('models', '模型配置', 'api', '为每项功能选择模型方案。');
  const connections = pane('connections', '连接方案', 'api');
  move(slots, fieldset('amily2_slot_assignments'));
  move(connections, fieldset('amily2_profile_list'), fieldset('amily2_keystore_mode'));
  const themeBlock = document.createElement('div'); themeBlock.className = 'am-sidebar-theme';
  themeBlock.innerHTML = `<label for="am-memory-theme">${icon('theme')}<span>主题</span></label><select id="am-memory-theme" aria-label="界面主题"><option value="st">跟随酒馆</option><option value="auto">跟随设备</option><option value="day">纸墨</option><option value="night">夜色</option><option value="green">青瓷</option></select>`;
  sidebar.querySelector('.am-sidebar-foot').append(themeBlock);
  const fontBlock = document.createElement('div'); fontBlock.className = 'am-sidebar-theme';
  fontBlock.innerHTML = '<label for="am-memory-font-size">字号</label><select id="am-memory-font-size" aria-label="界面字号"><option value="12">小</option><option value="13">标准</option><option value="15">大</option></select>';
  sidebar.querySelector('.am-sidebar-foot').append(fontBlock);
  // Preserve the complete original settings and authorization screen as an explicit route.
  const about = pane('about', '扩展信息与授权', 'about');
  const oldAbout = [...modules.about.children].filter(n => n !== about);
  move(about, ...oldAbout);
  const kbRoutes = [['retrieval', '知识库检索'], ['historiography', '知识库导入'], ['knowledge-bases', '知识库管理'], ['rerank', '重排序'], ['advanced', '知识库高级设置']];
  for (const [tab, title] of kbRoutes) pages.set(`kb-${tab}`, { element: root.querySelector(`#hly-${tab}-tab`), title, module: 'kb', tab });
  const auth = root.querySelector('#auth_panel');
  let current = 'memory', menuOpen = false, priorFocus, readToken = 0;
  const scrolls = new Map();
  const toggle = head.querySelector('.am-menu-toggle');
  const narrow = matchMedia('(max-width: 859px)');
  function setMenu(open, restoreFocus = true) {
    menuOpen = open; root.classList.toggle('am-sidebar-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '收起菜单' : '打开菜单');
    sidebar.inert = !open;
    content.inert = open && narrow.matches;
    backdrop.hidden = !open || !narrow.matches;
    if (open && narrow.matches) sidebar.querySelector('button').focus();
    else if (restoreFocus) toggle.focus();
  }
  function navigate(id, focus = false) {
    if (!pages.has(id)) return;
    if (!pluginAuthStatus.authorized) { syncAuth(); return; }
    scrolls.set(current, content.scrollTop); current = id;
    const page = pages.get(id);
    for (const [key, node] of Object.entries(modules)) node.hidden = key !== page.module;
    modules[page.module].style.display = 'block';
    for (const [key, route] of pages) if (!route.tab) route.element.hidden = key !== id;
    if (page.tab) root.querySelector(`.hly-nav-item[data-tab="${page.tab}"]`)?.click();
    if (id === 'kb-knowledge-bases' || id === 'kb-retrieval') window.updateHLYMemoryCount?.();
    root.dataset.route = id; head.querySelector('h1').textContent = page.title;
    sidebar.querySelectorAll('[data-route]').forEach(button => {
      if (button.dataset.route === id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    content.scrollTop = scrolls.get(id) || 0;
    if (narrow.matches) setMenu(false, false);
    if (focus) content.focus({ preventScroll: true });
    updateRetention();
    if (id === 'memory') refreshMemory();
  }
  function routeButton(parent, label, id) {
    const button = document.createElement('button'); button.type = 'button'; button.innerHTML = icon(id);
    const text = document.createElement('span'); text.textContent = label; button.append(text); button.dataset.route = id;
    button.addEventListener('click', () => navigate(id, true)); parent.append(button); return button;
  }
  const groups = [
    ['记忆', ['memory', 'floors', 'automatic', 'prompts', 'world', 'archives']],
    ['知识库', kbRoutes.map(([tab]) => `kb-${tab}`)],
    ['设置', ['models', 'connections', 'independent', 'about']],
  ];
  for (const [name, routes] of groups) {
    const group = document.createElement('div'); group.className = 'am-nav-group';
    const title = document.createElement('p'); title.textContent = name; group.append(title);
    for (const id of routes) routeButton(group, pages.get(id).title, id);
    sidebar.querySelector('nav').append(group);
  }
  for (const id of ['floors', 'automatic', 'prompts', 'world', 'archives']) routeButton(saved.querySelector('.am-quick-links'), pages.get(id).title, id);
  routeButton(slots, '管理连接方案', 'connections');
  function updateRetention() {
    const settings = extension_settings[extensionName] || {};
    const status = root.querySelector('.am-retention-note');
    if (status) status.textContent = `上下文保留 ${settings.autoHideThreshold ?? 30} 楼，最新 ${settings.historiographyRetentionCount ?? 5} 楼暂不总结。`;
  }
  async function refreshMemory() {
    const token = ++readToken;
    const context = getContext(); const chatId = context.chatId;
    const output = saved.querySelector('.am-memory-entries'); const status = saved.querySelector('.am-memory-status');
    output.replaceChildren(); status.textContent = '正在读取世界书…';
    try {
      const bookName = await getTargetLorebookName();
      const book = bookName ? await loadWorldInfo(bookName) : null;
      if (token !== readToken || getContext().chatId !== chatId) return;
      if (!pluginAuthStatus.authorized) { output.replaceChildren(); status.textContent = '请先完成授权。'; return; }
      const row = findActiveSummary(book);
      if (!row) { status.textContent = bookName ? '当前世界书还没有总结。' : '当前对话尚未关联世界书。'; return; }
      const parsed = parseLedgerForRefinement(row.content);
      if (!parsed.valid) { status.textContent = '旧总结格式需要单独检查。请先导出世界书备份。'; return; }
      status.textContent = `${bookName} · 已总结至 ${parsed.totalFloors} 楼`;
      if (parsed.missingHistoryThrough) status.textContent += ` · 前 ${parsed.missingHistoryThrough} 楼仅保留向量引用，原正文未在书中`;
      for (const [title, text] of [['最新大总结', parsed.latest?.text], ['历史大总结', parsed.history.map(item => `${item.startFloor}–${item.endFloor} 楼\n${item.text}`).join('\n\n')], ['后续小总结', parsed.pendingMicroContent]]) {
        const details = document.createElement('details'); details.open = title === '最新大总结';
        const summary = document.createElement('summary'); summary.textContent = title;
        const body = document.createElement('pre'); body.textContent = text || '暂无内容。'; details.append(summary, body); output.append(details);
      }
    } catch (error) { if (token === readToken) status.textContent = `读取失败：${error.message}。可点击刷新重试。`; }
  }
  function syncAuth() {
    const allowed = Boolean(pluginAuthStatus.authorized);
    root.classList.toggle('am-auth-locked', !allowed);
    sidebar.querySelectorAll('[data-route]').forEach(button => { button.disabled = !allowed; });
    if (!allowed) { ++readToken; saved.querySelector('.am-memory-entries').replaceChildren(); for (const node of Object.values(modules)) node.hidden = true; auth.style.display = 'block'; head.querySelector('h1').textContent = '授权验证'; }
    else { auth.style.display = 'none'; navigate(current); }
  }
  const authObserver = new MutationObserver(() => {
    if (root.classList.contains('am-auth-locked') === Boolean(pluginAuthStatus.authorized)) syncAuth();
  });
  authObserver.observe(auth, { attributes: true, attributeFilter: ['style'] });
  root.addEventListener('change', updateRetention);
  saved.querySelector('.am-refresh-memory').addEventListener('click', refreshMemory);
  saved.querySelector('.am-refresh-memory').insertAdjacentHTML('afterbegin', icon('refresh'));
  toggle.addEventListener('click', () => setMenu(!menuOpen));
  sidebar.querySelector('.am-menu-close').addEventListener('click', () => setMenu(false));
  backdrop.addEventListener('click', () => setMenu(false));
  function close() { dialog.close(); }
  head.querySelector('.am-app-exit').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (menuOpen && narrow.matches) { event.preventDefault(); setMenu(false); } });
  dialog.addEventListener('close', () => { setMenu(false, false); priorFocus?.focus?.(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !menuOpen || !narrow.matches) return;
    const buttons = [...sidebar.querySelectorAll('button:not(:disabled),select:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  narrow.addEventListener('change', () => setMenu(!narrow.matches, false));
  // Old navigation buttons remain for compatibility but direct all navigation through this shell.
  const oldRoutes = { amily2_open_additional_features: 'memory', amily2_open_rag_palace: 'kb-retrieval', amily2_open_api_config: 'connections', amily2_back_to_main_settings: 'memory', amily2_back_to_main_from_hanlinyuan: 'memory', amily2_back_to_main_from_api_config: 'memory' };
  root.addEventListener('click', event => {
    const target = event.target.closest('button'); const id = oldRoutes[target?.id];
    if (id) { event.preventDefault(); event.stopImmediatePropagation(); navigate(id); }
  }, true);
  for (const label of root.querySelectorAll('label[for$="-toggle"]')) {
    const id = label.htmlFor;
    if (!document.getElementById(id)) label.htmlFor = [id.replace(/-toggle$/, ''), id.replace(/-toggle$/, '-enabled')].find(value => document.getElementById(value)) || id;
  }
  organizeWorkspace(root);
  const missing = originalControls.filter(control => !root.contains(control));
  if (missing.length) throw new Error(`界面迁移遗漏 ${missing.length} 个原控件。`);
  workspace = { open() { priorFocus = document.activeElement; syncAuth(); if (!dialog.open) dialog.showModal(); setMenu(!narrow.matches, false); }, close, navigate, themeSelect: themeBlock.querySelector('select'), originalControlCount: originalControls.length };
  syncAuth(); setMenu(!narrow.matches, false);
  return workspace;
}
