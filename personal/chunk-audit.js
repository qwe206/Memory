// Exact text equality only. Similar overlapping excerpts are not classified as duplicates.
export function auditChunkDuplicates(chunks) {
  const groups=new Map();
  chunks.forEach((chunk,index)=>{const entries=groups.get(chunk.text)||[];entries.push(index+1);groups.set(chunk.text,entries);});
  const duplicates=[...groups.values()].filter(group=>group.length>1);
  const byNumber=new Map();for(const group of duplicates)for(const number of group)byNumber.set(number,group);
  return {unique:groups.size,extra:chunks.length-groups.size,groups:duplicates,byNumber};
}
