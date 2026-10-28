// ST may resolve saveWorldInfo even on an HTTP error and update its cache first.
// Confirm against the server, not that cache, before advancing a source cursor.
export async function confirmStoryLedgerWrite(context, bookName, expectedContent, invalidateCache = () => {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('/api/worldinfo/get', {
      method: 'POST', headers: context.getRequestHeaders(), cache: 'no-cache', signal: controller.signal,
      body: JSON.stringify({ name: bookName }),
    });
    if (!response.ok) throw new Error('无法确认世界书已保存，待总结进度保留。');
    const book = await response.json();
    if (!Object.values(book?.entries || {}).some(entry => !entry.disable && entry.content === expectedContent)) {
      throw new Error('世界书保存后回读不一致，未推进总结进度，请重试。');
    }
  } catch (error) {
    invalidateCache();
    if (controller.signal.aborted) throw new Error('确认世界书保存超时，待总结进度保留。');
    throw error;
  } finally { clearTimeout(timer); }
}
