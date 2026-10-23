// Empty edit fields mean reuse the saved key, never overwrite it with a mask.
export async function resolveProfileKey(manager, profileId, input) {
  const typed = String(input || '').trim();
  if (typed) return typed;
  if (!profileId) return '';
  try { return (await manager.getKey(profileId)) || ''; }
  catch { throw new Error('已保存的密钥读取失败，请检查当前设备的密钥存储设置。'); }
}
