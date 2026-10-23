// Display assigned connection metadata without putting decrypted credentials in
// the legacy fields or overwriting the saved fallback settings.
export function syncRerankProfile(root, profile, fallback = {}) {
  const values = profile ? {
    'hly-rerank-api-mode':'custom','hly-rerank-url':profile.apiUrl || '',
    'hly-rerank-model':profile.model || '', 'hly-rerank-api-key':''
  } : {'hly-rerank-api-mode':fallback.apiMode || 'custom','hly-rerank-url':fallback.url || '',
    'hly-rerank-model':fallback.model || '', 'hly-rerank-api-key':fallback.apiKey || ''};
  for (const [id,value] of Object.entries(values)) {
    const field = root.querySelector(`#${id}`); if (!field) continue;
    if (id === 'hly-rerank-model' && value && ![...field.options].some(item=>item.value===value)) {
      const item = field.ownerDocument.createElement('option'); item.value=value; item.textContent=value; field.add(item);
    }
    field.value=value; field.disabled=!!profile;
    if (id === 'hly-rerank-api-key') field.placeholder=profile ? '使用已分配方案的密钥' : '请输入您的 Rerank API Key';
  }
  const field=root.querySelector('#hly-rerank-model');
  const fetchButton=field?.parentElement?.querySelector('button');
  if (fetchButton) fetchButton.disabled=!!profile;
  let note=root.querySelector('#am-rerank-profile-status');
  if (!note && field) {
    note=field.ownerDocument.createElement('p');note.id='am-rerank-profile-status';note.className='notes';note.setAttribute('role','status');
    field.closest('fieldset').prepend(note);
  }
  if (note) note.textContent=profile
    ? `当前重排序方案：${profile.name}；模型：${profile.model || '未选择模型'}。连接参数以“模型配置”的分配为准，请到连接方案修改。`
    : '未分配重排序方案，使用这里的手动连接配置。';
}
