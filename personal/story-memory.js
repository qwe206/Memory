import { bindingKey } from './chat-memory-bindings.js';

/** One storyline spans new chat files until explicitly archived. */
export function enterStory(state, owner, chatId, length = 0, id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`) {
  if (!owner || !chatId) return null;
  state.stories ||= {}; state.storyChats ||= {}; state.activeStories ||= {};
  const key = bindingKey(owner, chatId), known = state.storyChats[key];
  let story = state.stories[known];
  if (!story) {
    const prior = state.stories[state.activeStories[owner]];
    const existing = state.chats?.[key];
    if (prior && !prior.archived && !existing?.length) story = prior;
    else {
      const storyId = id();
      story = state.stories[storyId] = { id: storyId, owner, archived: false, fresh: Boolean(prior), references: structuredClone(existing || []), segments: {}, progress: 0 };
    }
    const offset = Math.max(story.progress || 0, ...Object.values(story.segments).map(segment => segment.offset + segment.length));
    story.segments[chatId] = { offset, length: 0 };
    state.storyChats[key] = story.id;
  }
  story.segments[chatId].length = Math.max(story.segments[chatId].length, length);
  // Visiting a historical/archived chat does not replace the open storyline.
  if (!story.archived) state.activeStories[owner] = story.id;
  return story;
}

export function storyForChat(state, owner, chatId) {
  return state.stories?.[state.storyChats?.[bindingKey(owner, chatId)]] || null;
}

export function storyBindings(state, owner, chatId) {
  return storyForChat(state, owner, chatId)?.references || state.chats?.[bindingKey(owner, chatId)] || [];
}

export function setStoryBindings(state, owner, chatId, references) {
  const story = storyForChat(state, owner, chatId);
  if (story) story.references = structuredClone(references);
  state.chats ||= {}; state.chats[bindingKey(owner, chatId)] = structuredClone(references);
}

export function storyWorldbook(story, fallback) {
  if (!story || !fallback) return fallback;
  story.worldbook ||= story.fresh ? `${fallback} · 剧情-${story.id}` : fallback;
  return story.worldbook;
}

export function archiveStory(state, owner, chatId, snapshot) {
  const story = storyForChat(state, owner, chatId);
  if (!story) throw new Error('未找到当前剧情，归档已停止。');
  story.archived = true; story.archiveChat = chatId;
  story.references = structuredClone(snapshot.references);
  return structuredClone(story);
}

export function restoreStory(state, owner, chatId, snapshot, currentLength = 0) {
  if (!snapshot?.id || snapshot.owner !== owner) throw new Error('归档不属于当前角色。');
  const copy = structuredClone(snapshot); copy.archived = false;
  // Replaying an archive creates a branch so old chat bindings keep their history.
  copy.id = `${snapshot.id}-restore-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.stories ||= {}; state.storyChats ||= {}; state.activeStories ||= {};
  if (!copy.segments[chatId]) copy.segments[chatId] = { offset: (copy.progress || 0) - currentLength, length: currentLength };
  state.stories[copy.id] = copy;
  state.storyChats[bindingKey(owner, chatId)] = copy.id;
  state.activeStories[owner] = copy.id;
  setStoryBindings(state, owner, chatId, copy.references);
  return copy;
}
