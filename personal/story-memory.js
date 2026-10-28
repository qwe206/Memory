import { bindingKey } from './chat-memory-bindings.js';

/** Files share a story until it is archived. Progress always belongs to a file. */
export function enterStory(state, owner, chatId, length = 0, id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`) {
  if (!owner || !chatId) return null;
  state.stories ||= {}; state.storyChats ||= {}; state.activeStories ||= {};
  const key = bindingKey(owner, chatId);
  let story = state.stories[state.storyChats[key]];
  if (!story) {
    const prior = state.stories[state.activeStories[owner]], existing = state.chats?.[key];
    if (prior && !prior.archived && !existing?.length) story = prior;
    else {
      const storyId = id();
      story = state.stories[storyId] = { id: storyId, owner, archived: false, fresh: Boolean(prior), references: structuredClone(existing || []), files: {} };
    }
    state.storyChats[key] = story.id;
  }
  ensureStoryFiles(story);
  if (!Object.hasOwn(story.files, chatId)) {
    const file = { length: 0, summarizedThrough: 0 };
    if (!Object.keys(story.files).length) file.legacyOffset = 0;
    Object.defineProperty(story.files, chatId, { value: file, enumerable: true, writable: true, configurable: true });
  }
  story.files[chatId].length = Math.max(story.files[chatId].length, length);
  if (!story.archived) state.activeStories[owner] = story.id;
  return story;
}

// Migrate published snapshots and the previous local draft without rewriting old summaries.
export function ensureStoryFiles(story) {
  if (story.files) return;
  story.files = {};
  for (const [chatFile, segment] of Object.entries(story.segments || {})) {
    let through = 0;
    for (const range of segment.ranges || []) {
      if (range.localStart > through + 1 || range.summarizedTo < range.localStart) break;
      through = range.summarizedTo ?? through;
      if (through < range.localEnd) break;
    }
    story.files[chatFile] = { length: segment.length, summarizedThrough: through, legacyOffset: segment.offset,
      initialized: Boolean(story.coverageVersion), skipThrough: Math.max(0, ...(segment.ranges || []).map(range => range.retiredThrough || 0)) };
  }
}

export function syncStoryProgress(story, content = '') {
  if (!story) return;
  ensureStoryFiles(story);
  const footer = content.match(/<!--MemoryFiles (\{[^\n]*\}) -->/);
  let saved; try { saved = footer ? JSON.parse(footer[1]) : null; } catch { saved = null; }
  const sources = [...content.matchAll(/^来源聊天文件：(\"(?:\\.|[^\"\\])*\")；本地第(\d+)至(\d+)楼[。；]/gm)];
  const seal = Number(content.match(/本条勿动【前(\d+)楼总结已完成】/)?.[1] || 0);
  const compiled = Number(content.match(/【前(\d+)楼篇章编撰已完成】/)?.[1] || 0);
  for (const [chatFile, file] of Object.entries(story.files)) {
    if (!file.initialized) {
      const legacy = Object.hasOwn(file, 'legacyOffset') ? (sources.length ? compiled : seal) - file.legacyOffset : 0;
      file.summarizedThrough = Math.max(file.summarizedThrough, Math.min(file.length, Math.max(0, legacy)));
      for (const match of sources) if (JSON.parse(match[1]) === chatFile && Number(match[2]) <= file.summarizedThrough + 1) file.summarizedThrough = Math.max(file.summarizedThrough, Math.min(file.length, Number(match[3])));
      file.initialized = true;
    }
    if (Number.isInteger(saved?.[chatFile]) && saved[chatFile] >= 0) file.summarizedThrough = Math.max(file.summarizedThrough, Math.min(file.length, saved[chatFile]));
  }
}

export function completeStorySources(story, sources) {
  ensureStoryFiles(story);
  for (const source of sources) {
    const file = story.files[source.chatFile];
    if (file && source.localStartFloor <= Math.max(file.summarizedThrough, file.skipThrough || 0) + 1) file.summarizedThrough = Math.max(file.summarizedThrough, source.localEndFloor);
  }
}

export function storyProgressFooter(story, sources = []) {
  const snapshot = structuredClone(story); completeStorySources(snapshot, sources);
  const progress = Object.fromEntries(Object.entries(snapshot.files).map(([name, file]) => [name, file.summarizedThrough]));
  return '<!--MemoryFiles ' + JSON.stringify(progress).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + ' -->';
}

export function storySummarizedPrefix(story, chatFile) {
  if (!story) return 0;
  ensureStoryFiles(story);
  return story.files[chatFile]?.summarizedThrough || 0;
}

export function storySummaryBatch(story, chatFile, batchSize, retention = 0, fullBatch = false) {
  if (!story || story.archived) return null;
  ensureStoryFiles(story);
  const file = story.files[chatFile]; if (!file) return null;
  const startFloor = Math.max(file.summarizedThrough, file.skipThrough || 0) + 1;
  const endFloor = Math.min(file.length - retention, startFloor + batchSize - 1);
  if (endFloor < startFloor || (fullBatch && endFloor - startFloor + 1 < batchSize)) return null;
  return { chatFile, startFloor, endFloor };
}

export function storyForChat(state, owner, chatId) { return state.stories?.[state.storyChats?.[bindingKey(owner, chatId)]] || null; }
export function storyBindings(state, owner, chatId) { return storyForChat(state, owner, chatId)?.references || state.chats?.[bindingKey(owner, chatId)] || []; }
export function setStoryBindings(state, owner, chatId, references) {
  const story = storyForChat(state, owner, chatId); if (story) story.references = structuredClone(references);
  state.chats ||= {}; state.chats[bindingKey(owner, chatId)] = structuredClone(references);
}
export function storyWorldbook(story, fallback) {
  if (!story || !fallback) return fallback;
  story.worldbook ||= story.fresh ? `${fallback} · 剧情-${story.id}` : fallback;
  return story.worldbook;
}
export function archiveStory(state, owner, chatId, snapshot) {
  const story = storyForChat(state, owner, chatId); if (!story) throw new Error('未找到当前剧情，归档已停止。');
  story.archived = true; story.archiveChat = chatId; story.references = structuredClone(snapshot.references);
  return structuredClone(story);
}
export function restoreStory(state, owner, chatId, snapshot, currentLength = 0) {
  if (!snapshot?.id || snapshot.owner !== owner) throw new Error('归档不属于当前角色。');
  const copy = structuredClone(snapshot); copy.archived = false; ensureStoryFiles(copy);
  copy.id = `${snapshot.id}-restore-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (!Object.hasOwn(copy.files, chatId)) {
    for (const file of Object.values(copy.files)) file.skipThrough = file.length;
    copy.files[chatId] = { length: currentLength, summarizedThrough: 0, skipThrough: currentLength, initialized: true };
  }
  state.stories ||= {}; state.storyChats ||= {}; state.activeStories ||= {};
  state.stories[copy.id] = copy; state.storyChats[bindingKey(owner, chatId)] = copy.id; state.activeStories[owner] = copy.id;
  setStoryBindings(state, owner, chatId, copy.references); return copy;
}
