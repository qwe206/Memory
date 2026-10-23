// Verify the selected model with a small inference request, never /models.
export async function testSelectedProfile(profile, { fetcher = fetch, headers = {}, signal } = {}) {
  const { model, apiKey, provider = 'openai', type = 'chat' } = profile;
  if (!model?.trim()) throw new Error('请先选择或填写要测试的模型。');
  if (!profile.apiUrl?.trim()) throw new Error('请先填写 API 地址。');
  if (provider === 'sillytavern_preset') throw new Error('酒馆预设请在独立总结页测试；此处需要可直接调用的模型配置。');
  let endpoint, body, requestHeaders = { 'Content-Type': 'application/json' };
  const base = profile.apiUrl.trim().replace(/\/+$/, '');
  if (provider === 'google') {
    if (!apiKey) throw new Error('请先保存或填写 Google API Key。');
    if (type === 'rerank') throw new Error('Google 直连接口不支持此重排序测试。');
    const method = type === 'embedding' ? 'embedContent' : 'generateContent';
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:${method}`;
    requestHeaders['x-goog-api-key'] = apiKey;
    body = type === 'embedding' ? { content: { parts: [{ text: 'connection test' }] } }
      : { contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }], generationConfig: { maxOutputTokens: 64 } };
  } else if (type === 'chat') {
    endpoint = '/api/backends/chat-completions/generate';
    requestHeaders = { ...headers, ...requestHeaders };
    body = { chat_completion_source: 'openai', reverse_proxy: base, proxy_password: apiKey || '', model,
      messages: [{ role: 'user', content: 'Reply OK.' }], stream: false, max_tokens: 64 };
  } else {
    const suffix = type === 'embedding' ? 'embeddings' : 'rerank';
    const apiBase = base.replace(/\/(?:embeddings|rerank|chat\/completions)$/, '');
    endpoint = `${apiBase.endsWith('/v1') ? apiBase : apiBase + '/v1'}/${suffix}`;
    if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;
    body = type === 'embedding' ? { model, input: ['connection test'] }
      : { model, query: 'connection test', documents: ['connection test'], top_n: 1 };
  }
  const response = await fetcher(endpoint, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body), signal });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    const detail = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${response.status}`;
    throw new Error(apiKey ? String(detail).split(apiKey).join('[密钥已隐藏]') : String(detail));
  }
  const valid = type === 'embedding'
    ? (data?.data?.[0]?.embedding || data?.embedding?.values)?.length > 0
    : type === 'rerank' ? Array.isArray(data?.results) && data.results.length > 0
      : provider === 'google' ? data?.candidates?.[0]?.content?.parts?.some(part => part.text?.trim())
        : Boolean(data?.choices?.[0]?.message?.content?.trim());
  if (!valid) throw new Error('所选模型未返回有效结果，不能确认连接成功。');
  return { model, type };
}
