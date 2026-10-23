export function regenerationMessages(messages, firstDraft, requirements) {
  const request = String(requirements || '').trim();
  if (!request) return messages.map(message => ({ ...message }));
  return [...messages.map(message => ({ ...message })),
    { role: 'assistant', content: String(firstDraft) },
    { role: 'user', content: `请依据上面的原始输入和第一版结果，按以下补充要求重新生成完整总结。第一版只是待修订草稿，事实以原始输入为准，不能把草稿中的错误当成事实。保持原任务的输出格式。\n补充要求：\n${request}` },
  ];
}
