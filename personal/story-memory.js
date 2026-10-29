import { bindingKey } from './chat-memory-bindings.js';

/** Files share memory until the story is archived; summary progress stays in the worldbook. */
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
    const file = { length: 0 };
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
    story.files[chatFile] = { length: segment.length };
  }
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
    copy.files[chatId] = { length: currentLength };
  }
  state.stories ||= {}; state.storyChats ||= {}; state.activeStories ||= {};
  state.stories[copy.id] = copy; state.storyChats[bindingKey(owner, chatId)] = copy.id; state.activeStories[owner] = copy.id;
  setStoryBindings(state, owner, chatId, copy.references); return copy;
}
