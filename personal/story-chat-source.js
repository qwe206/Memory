// Read historical raw messages without changing ST's active chat or generation state.
export async function readStoryChat(context, chatFile, signal) {
  const current = context.chatId ?? context.getCurrentChatId?.() ?? context.chat_filename;
  if (chatFile === current) return context.chat;
  const group = context.groupId != null;
  const avatar = context.characters?.[context.characterId]?.avatar;
  if (!group && !avatar) throw new Error('无法确定历史聊天所属角色，补总结已暂停。');
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) { cancel(); throw signal.reason || new Error('读取历史聊天已取消。'); }
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
  const response = await fetch(group ? '/api/chats/group/get' : '/api/chats/get', {
    method: 'POST', headers: context.getRequestHeaders(), signal: controller.signal,
    body: JSON.stringify(group ? { id: chatFile } : { avatar_url: avatar, file_name: chatFile }),
  });
  if (!response.ok) throw new Error(`读取历史聊天 ${chatFile} 失败（HTTP ${response.status}），待总结内容已保留。`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`历史聊天 ${chatFile} 格式异常，补总结已暂停。`);
  // A character chat has one metadata header. A group chat may have none.
  const messages = data[0] && typeof data[0].mes !== 'string' && (data[0].chat_metadata != null || data[0].user_name != null || data[0].character_name != null) ? data.slice(1) : data;
  if (messages.some(message => typeof message?.mes !== 'string')) throw new Error(`历史聊天 ${chatFile} 有无法读取的消息，补总结已暂停。`);
  return messages;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error(`读取历史聊天 ${chatFile} 超时，待总结内容已保留。`);
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export function storyChatFingerprint(chat, start, end) {
  return JSON.stringify(chat.slice(start - 1, end).map(message => [message.send_date, message.name, message.is_user, message.mes]));
}
