import { notify as toastr } from './notify.js';
import { isSummaryEntry } from './names.js';
import { exportLedgerBackups } from './backups.js';
import { getTargetLorebookName, getLoresForWorldbook, vectorizeRetainedLedgerHistory } from '../core/historiographer.js';
const removed = [
  'amily2_open_memorisation_forms', 'amily2_open_plot_optimization', 'amily2_open_character_world_book',
  'amily2_open_text_optimization', 'amily2_open_world_editor', 'amily2_open_glossary', 'amily2_open_renderer',
  'amily2_open_sfigen', 'amily2_open_super_memory', 'amily2_open_auto_char_card', 'amily2_open_progressive_memory',
  'amily2_open_time_river', 'amily2_open_security_audit', 'amily2_test', 'amily2_fix_now',
];
export function trimPersonalPanel(root) {
  if (!root) return;
  root.classList.add('amily2-memory-personal');
  const words = [
    ['Memory', 'Memory'], ['返回主殿', '返回首页'], ['内阁密室', '总结与楼层管理'],
    ['皇家史册管理员', '自动隐藏楼层'], ['手动敕令司', '手动隐藏楼层'], ['总结与律法', '世界书写入设置'],
    ['确认敕令', '保存设置'], ['选择编辑的谕旨', '选择提示词'], ['开始远征', '批量总结'],
    ['微言录', '小总结'], ['宏史卷', '大总结'], ['翰林院', '向量知识库'], ['史册精炼', '合并小总结'],
    ['史册归档与回溯', '总结归档与恢复'], ['回溯选中史册', '恢复选中的总结'],
    ['交互式巡录', '预览后写入'], ['静默总结', '自动总结'], ['开始精炼', '生成大总结'],
    ['目标世界书 (世界书)', '目标世界书'], ['待精炼的史册条目', '总结条目'],
    ['开启忆识检索之权', '启用记忆检索'], ['忆识检索', '检索设置'], ['书库编纂', '导入内容'],
    ['忆识精炼', '重排序'], ['忆识', '记忆'], ['宝库', '知识库'],
  ];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('textarea,script,style')) continue;
    for (const [from, to] of words) node.textContent = node.textContent.replaceAll(from, to);
  }
  const plainTerms = [
    ['破限谕旨','引导提示词'], ['概要纲要','总结要求'],
    ['神力之源', '向量模型'], ['测试神力', '测试连接'], ['重置为初', '恢复默认'],
    ['通行令牌', '密钥'], ['圣言注入', '内容注入'], ['圣言模板', '注入模板'],
    ['起居注', '运行日志'], ['上奏设定', '通知设置'], ['上奏', '通知'],
    ['书卷尺寸', '分块字数'], ['上下文关联度', '重叠字数'], ['记忆匹配度', '匹配阈值'],
    ['准许凝识', '启用聊天凝练'], ['凝识', '凝练'], ['在此处粘贴您要录入的知识文书：', '粘贴要录入的文本：'],
    ['帝国徽记位置', '入口位置'], ['驻扎顶栏', '顶栏'], ['收归扩展', '扩展设置'],
  ];
  for (const element of root.querySelectorAll('label,legend,button,summary,small')) {
    for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE) {
      for (const [from, to] of plainTerms) node.textContent = node.textContent.replaceAll(from, to);
    }
  }
  for (const id of removed) root.querySelector(`#${id}`)?.remove();
  // These controls only configure the removed正文优化 processor, not memory summaries.
  for (const id of ['amily2_hidden_prompts', 'amily2_optimization_enabled', 'amily2_greeting_optimization_enabled', 'amily2_plot_opt_enabled', 'amily2_super_memory_enabled']) {
    const item = root.querySelector(`#${id}`); (item?.closest('fieldset') || item)?.remove();
  }
  for (const group of root.querySelectorAll('.plugin-features > fieldset')) {
    const buttons = group.querySelector('.button-group');
    if (buttons && !buttons.querySelector('button')) group.remove();
  }
  root.querySelectorAll('[data-amily-i18n="app.name"]').forEach(node => { node.textContent = 'Memory'; });
  const latestVersion = root.querySelector('#amily2_latest_version'); if (latestVersion) latestVersion.textContent = '通过酒馆扩展管理更新';
  const version = root.querySelector('#amily2_current_version'); if (version) version.textContent = '1.0.10';
}
export function bindPersonalHistoryActions(root) {
  const controls = root.querySelector('#amily2_vectorize_summary_content')?.closest('.auto-control-pair');
  if (!controls || root.querySelector('#amily2_personal_retry_history')) return;
  const help = document.createElement('p'); help.className = 'notes';
  help.textContent = '每次只合并新的小总结。兼容旧版对话流水总帐；旧大总结回读入库成功后才移出。旧向量占位提示会保留，不会补造已缺失的正文。修改前备份保存在本地。';
  const retry = document.createElement('button'); retry.type = 'button'; retry.id = 'amily2_personal_retry_history'; retry.className = 'menu_button'; retry.textContent = '将保留的历史大总结入库';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    try {
      const book = (root.querySelector('#amily2_mhb_large_worldbook_selector')?.value || await getTargetLorebookName()); if (!book) throw new Error('请先选择目标世界书。');
      const rows = await getLoresForWorldbook(book); const active = rows.find(row => row.key === root.querySelector('#amily2_mhb_large_lore_selector')?.value) || rows.find(row => isSummaryEntry(row));
      if (!active) throw new Error('未找到活动的单条目总结；旧分段条目请先导出世界书后恢复。');
      await vectorizeRetainedLedgerHistory(book, active.key);
    } catch (error) { toastr.error(error.message); }
    finally { retry.disabled = false; }
  });
  const backup = document.createElement('button'); backup.id = 'amily2_personal_export_backups'; backup.type = 'button'; backup.className = 'menu_button'; backup.textContent = '导出修改前的备份';
  backup.addEventListener('click', async () => {
    try {
      const rows = await exportLedgerBackups();
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'amily2-personal-backups/v1', backups: rows }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'Memory-总结备份.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toastr.error(error.message); }
  });
  controls.after(help, retry, backup);
}
