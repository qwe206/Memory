/** Bindings reference stored vectors; they never copy, rewrite or delete them. */
export function bindingOwner(context) {
  if (context.groupId != null) return `group:${context.groupId}`;
  const character = context.characters?.[context.characterId];
  return character?.avatar ? `character:${character.avatar}` : null;
}

export function bindingKey(owner, chatId) {
  return owner && chatId ? JSON.stringify([owner, String(chatId)]) : null;
}

export function chunkHash(hash) {
  if (hash === null || hash === undefined || hash === '') return null;
  return Number.isFinite(Number(hash)) ? String(Number(hash)) : String(hash);
}

export function chatBindings(state, owner, chatId) {
  return state?.chats?.[bindingKey(owner, chatId)] || [];
}

export function updateChatBindings(state, owner, chatIds, references, remove = false) {
  if (!owner || !chatIds.length) throw new Error('请先打开聊天并选择聊天文件。');
  state.chats ||= {};
  const pending = {};
  for (const chatId of new Set(chatIds)) {
    const key = bindingKey(owner, chatId);
    if (!key) throw new Error('聊天文件名称不能为空。');
    const entries = new Map(chatBindings(state, owner, chatId).map(ref => [ref.collectionId, { ...ref }]));
    for (const ref of references) {
      if (!ref.collectionId) throw new Error('无法识别向量集合。');
      const prior = entries.get(ref.collectionId);
      const hashes = ref.hashes === null ? null : [...new Set((ref.hashes || []).map(chunkHash).filter(v => v !== null))];
      if (remove) {
        if (!prior) continue;
        if (hashes === null) entries.delete(ref.collectionId);
        else {
          // Removing a subset from a whole-library binding needs the full hash list.
          if (prior.hashes === null) throw new Error('请先在当前聊天的绑定列表解除整库绑定，再绑定需要的分块。');
          const excluded = new Set(hashes);
          const remaining = prior.hashes.filter(hash => !excluded.has(chunkHash(hash)));
          if (remaining.length) entries.set(ref.collectionId, { ...prior, hashes: remaining });
          else entries.delete(ref.collectionId);
        }
      } else if (hashes === null || prior?.hashes === null) {
        entries.set(ref.collectionId, { ...ref, hashes: null });
      } else if (hashes.length) {
        entries.set(ref.collectionId, { ...ref, hashes: [...new Set([...(prior?.hashes || []), ...hashes])] });
      }
    }
    pending[key] = [...entries.values()];
  }
  Object.assign(state.chats, pending);
}

export function restrictBasesToChat(bases, state, owner, chatId) {
  const refs = new Map(chatBindings(state, owner, chatId).map(ref => [ref.collectionId, ref]));
  return bases.flatMap(base => {
    const ref = refs.get(base.collectionId);
    return ref && (ref.hashes === null || ref.hashes?.length)
      ? [{ ...base, boundHashes: ref.hashes }] : [];
  });
}

export function filterBoundChunks(rows, hashes, limit) {
  const allowed = hashes == null ? null : new Set(hashes.map(chunkHash));
  return rows.filter(row => typeof row?.text === 'string' && (!allowed || allowed.has(chunkHash(row.hash))))
    .sort((a, b) => (b.score ?? 1) - (a.score ?? 1)).slice(0, limit);
}
