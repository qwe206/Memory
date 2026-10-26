/** Request a saved ST connection directly; never switch the active chat profile. */
export async function requestSummaryPreset(context, profileId, messages, options = {}) {
  if (!profileId) throw new Error('未配置 SillyTavern 连接预设。');
  const profile = context?.extensionSettings?.connectionManager?.profiles?.find(item => item.id === profileId);
  if (!profile) throw new Error('未找到指定的 SillyTavern 连接预设。');
  const service = context.ConnectionManagerRequestService;
  if (typeof service?.sendRequest !== 'function') throw new Error('当前酒馆不支持独立预设请求，请更新酒馆或改用独立总结连接。');
  const controller = new AbortController();
  return service.sendRequest(profile.id, messages, options.maxTokens || 4000, {
    stream: false, extractData: true, includePreset: true, signal: controller.signal,
  });
}
