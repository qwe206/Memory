// Native selection and manual entry stay separate, including on touch devices.
function cacheKey(root) {
  return 'amily3-models:' + JSON.stringify(['provider', 'url', 'type'].map(name => root.querySelector(`#amily2_pf_${name}`)?.value || ''));
}
export function setModelOptions(root, models, current = '', persist = false) {
  const list = root.querySelector('#amily2_pf_model_list');
  if (!list) return;
  const values = [...new Set(models.filter(value => typeof value === 'string' && value.trim()))];
  if (persist) {
    try { localStorage.setItem(cacheKey(root), JSON.stringify(values)); } catch { /* Selection still works with full storage. */ }
  }
  if (current && !values.includes(current)) values.unshift(current);
  list.replaceChildren(new Option(values.length ? '请选择模型' : '请先获取模型，或在下方手动填写', ''), ...values.map(value => new Option(value, value)));
  list.value = current;
  list.hidden = false;
}
export function restoreModelOptions(root, current = '') {
  let models = [];
  try { models = JSON.parse(localStorage.getItem(cacheKey(root)) || '[]'); } catch { /* Ignore a corrupt cache. */ }
  setModelOptions(root, Array.isArray(models) ? models : [], current);
}
export function bindModelPicker(root) {
  const input = root.querySelector('#amily2_pf_model');
  const list = root.querySelector('#amily2_pf_model_list');
  if (!input || !list || input.dataset.pickerBound) return;
  input.dataset.pickerBound = 'true';
  list.addEventListener('change', () => {
    input.value = list.value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  input.addEventListener('input', () => {
    list.value = [...list.options].some(option => option.value === input.value.trim()) ? input.value.trim() : '';
  });
}
