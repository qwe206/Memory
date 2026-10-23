export function createSummarySelectors({bookSelect,entrySelect,listBooks,targetBook,listEntries,isSummary,option}) {
  let booksRevision = 0, entriesRevision = 0;
  async function refreshEntries() {
    const revision = ++entriesRevision, name = bookSelect.value;
    entrySelect.replaceChildren(option('', name ? '正在读取总结条目…' : '当前角色未选择总结世界书'));
    entrySelect.value = '';
    if (!name) return;
    const entries = await listEntries(name);
    if (revision !== entriesRevision || bookSelect.value !== name) return;
    entrySelect.replaceChildren(option('', '请选择总结条目'), ...entries.map(row => option(row.key, `[${row.key}] ${row.comment}`)));
    const active = entries.filter(isSummary);
    entrySelect.value = active.length === 1 ? String(active[0].key) : '';
  }
  async function refresh() {
    const revision = ++booksRevision;
    entriesRevision++;
    const [books,target] = await Promise.all([listBooks(),targetBook()]);
    if (revision !== booksRevision) return;
    bookSelect.replaceChildren(option('', '当前角色的总结世界书未绑定或不存在'), ...books.map(name => option(name,name)));
    bookSelect.value = books.includes(target) ? target : '';
    await refreshEntries();
  }
  return {refresh,refreshEntries};
}
