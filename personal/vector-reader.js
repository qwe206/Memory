/** Read existing stored chunks only; never re-split or rewrite user data. */
export async function readVectorChunks({ collectionId, headers, embed, signal, fetcher = fetch }) {
  async function post(path, body) {
    const response = await fetcher(`/api/vector/${path}`, { method: 'POST', headers, signal, body: JSON.stringify({ collectionId, source: 'webllm', embeddings: {}, ...body }) });
    if (!response.ok) throw new Error(`读取分块失败（HTTP ${response.status}）。`);
    return response.json();
  }
  const saved = await post('list', {});
  const hashes = Array.isArray(saved) ? saved : saved?.hashes;
  if (!Array.isArray(hashes)) throw new Error('酒馆返回的分块列表格式不正确。');
  if (!hashes.length) return { total: 0, chunks: [], complete: true };
  if (hashes.length > 10000) throw new Error('此知识库超过一万块，暂不支持整库查看。');
  const searchText = '查看知识库分块';
  const [vector] = await embed([searchText], signal);
  if (!Array.isArray(vector) || !vector.length || vector.some(n => !Number.isFinite(n))) throw new Error('嵌入连接不可用，无法读取分块内容。');
  const result = await post('query', { searchText, topK: hashes.length, threshold: -1, embeddings: { [searchText]: vector } });
  if (!Array.isArray(result?.metadata)) throw new Error('酒馆没有返回分块正文。');
  const chunks = result.metadata.filter(row => typeof row?.text === 'string').map(row => ({ text: row.text, hash: row.hash, index: row.index }));
  chunks.sort((a,b) => Number.isFinite(a.index) && Number.isFinite(b.index) ? a.index-b.index : a.text.localeCompare(b.text,'zh-CN',{numeric:true}));
  return { total: hashes.length, chunks, complete: chunks.length === hashes.length };
}
