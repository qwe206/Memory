// The host generates storage IDs on every insert. A stable metadata hash is not an upsert key.
const queues = new Map();

export async function writeUniqueVectorChunks({collectionId, vectorItems, headers, signal, generateHash, fetcher = fetch}) {
  if(!collectionId)throw new Error('入库缺少知识库ID。');
  if(vectorItems.some(item=>typeof item.text!=='string'||!Array.isArray(item.vector)||!item.vector.length||item.vector.some(n=>!Number.isFinite(n))))throw new Error('向量模型返回无效数据，原总结不会移出。');
  if(!vectorItems.length)return {success:true,count:0,inserted:0};
  const previous=queues.get(collectionId)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    const unique=[...new Map(vectorItems.map(item=>[item.text,item])).values()];
    async function post(path,body={}) {
      const response=await fetcher(`/api/vector/${path}`,{method:'POST',headers,signal,body:JSON.stringify({collectionId,source:'webllm',embeddings:{},...body})});
      if(!response.ok)throw new Error(`向量${path==='insert'?'存入API错误':'回读失败'} ${response.status}，原总结保留。`);
      return path==='insert'?null:response.json();
    }
    async function storedTexts() {
      const listing=await post('list'),hashes=Array.isArray(listing)?listing:listing?.hashes;
      if(!Array.isArray(hashes))throw new Error('分块列表格式异常，原总结保留。');
      if(!hashes.length)return new Set();
      if(hashes.length>10000)throw new Error('知识库超过一万块，无法完整核对；原总结保留。');
      const searchText=unique[0].text;
      const result=await post('query',{searchText,topK:hashes.length,threshold:-1,embeddings:{[searchText]:unique[0].vector}});
      if(!Array.isArray(result?.metadata)||result.metadata.length!==hashes.length||result.metadata.some(row=>typeof row?.text!=='string'))throw new Error('未能回读全部入库分块，原总结保留。');
      return new Set(result.metadata.map(row=>row.text));
    }
    const existing=await storedTexts();
    const pending=unique.filter(item=>!existing.has(item.text));
    if(pending.length) {
      const items=pending.map(item=>({hash:generateHash(collectionId+':'+item.text),text:item.text,metadata:item.metadata||{}}));
      const embeddings=Object.fromEntries(pending.map(item=>[item.text,item.vector]));
      await post('insert',{items,embeddings});
      const verified=await storedTexts();
      if(unique.some(item=>!verified.has(item.text)))throw new Error('未能回读全部入库分块，原总结保留。');
    }
    return {success:true,count:unique.length,inserted:pending.length};
  });
  queues.set(collectionId,task);
  try {return await task;} finally {if(queues.get(collectionId)===task)queues.delete(collectionId);}
}
