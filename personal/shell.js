import { mountWorkspace } from './workspace.js';

export function mountMemoryShell(root) {
  if (!root || root.classList.contains('am-workspace')) return;
  root.classList.add('am-memory-ui');
  const workspace = mountWorkspace(root);
  const fontSize = root.querySelector('#am-memory-font-size');
  const applySize = value => {
    const size = ['12', '13', '15'].includes(value) ? value : '13';
    fontSize.value = size;
    for (const target of [root, ...document.querySelectorAll('dialog.am-memory-ui')]) target.style.setProperty('--am-text-size', `${size}px`);
  };
  applySize(localStorage.getItem('amily2_memory_font_size'));
  fontSize.addEventListener('change', () => { localStorage.setItem('amily2_memory_font_size',fontSize.value); applySize(fontSize.value); });
  const saved = localStorage.getItem('amily2_memory_theme') || 'st';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const apply = value => {
    const theme = value === 'auto' ? (system.matches ? 'night' : 'day') : value;
    root.dataset.memoryTheme = theme;
    document.querySelectorAll('dialog.am-memory-ui').forEach(dialog => { dialog.dataset.memoryTheme = theme; });
  };
  const hostColors = ['--am-host-bg', '--am-host-surface', '--am-host-ink', '--am-host-line', '--am-host-accent', '--am-host-accent-ink', '--am-host-color-scheme', '--am-host-font', '--am-host-solid-surface'];
  const syncHost = () => {
    const host = getComputedStyle(document.body);
    const get = (name, fallback) => host.getPropertyValue(name).trim() || fallback;
    const colors = [get('--SmartThemeBlurTintColor', '#292d35'), get('--SmartThemeChatTintColor', get('--SmartThemeBlurTintColor', '#343b45')), get('--SmartThemeBodyColor', '#ddd'), get('--SmartThemeBorderColor', '#555'), get('--SmartThemeQuoteColor', '#8ec7ee')];
    // Let the browser normalize RGB/OKLCH/alpha host colors before choosing button text.
    const probe = document.createElement('canvas').getContext('2d');
    const pixel = color => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = color; probe.fillRect(0, 0, 1, 1); return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); };
    const luminance = color => pixel(color).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const accent = luminance(colors[4]);
    colors.push(accent > .179 ? '#000000' : '#ffffff', luminance(colors[0]) > .179 ? 'light' : 'dark');
    colors.push(host.fontFamily);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = luminance(colors[0]) > .179 ? '#ffffff' : '#202124';
    probe.fillRect(0, 0, 1, 1);
    probe.fillStyle = colors[1]; probe.fillRect(0, 0, 1, 1);
    const rgb = [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3);
    colors.push(`rgb(${rgb.join(',')})`);
    for (const target of [root, ...document.querySelectorAll('dialog.am-memory-ui')]) hostColors.forEach((name, i) => target.style.setProperty(name, colors[i]));
  };
  syncHost();
  const observer = new MutationObserver(syncHost);
  observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
  observer.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] });
  apply(saved);
  const select = workspace.themeSelect; select.value = saved;
  select.addEventListener('change', () => { localStorage.setItem('amily2_memory_theme', select.value); apply(select.value); });
  system.addEventListener('change', () => { if (select.value === 'auto') apply('auto'); });
  const profile = root.querySelector('#amily2_profile_modal');
  if (profile) themeMemoryDialog(profile);
}

export function themeMemoryDialog(dialog) {
  dialog.classList.add('am-memory-ui');
  dialog.dataset.memoryTheme = document.querySelector('#amily2_chat_optimiser')?.dataset.memoryTheme || 'day';
  const root = document.querySelector('#amily2_chat_optimiser');
  if (root) for (let i = 0; i < root.style.length; i++) {
    const name = root.style[i];
    if (name.startsWith('--am-host-') || name === '--am-text-size') dialog.style.setProperty(name, root.style.getPropertyValue(name));
  }
}
