import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = await fs.readFile(new URL('../floor-jump.js', import.meta.url), 'utf8');
const { ensureFloorRendered, revealFloorInChat } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const node = id => ({ getAttribute: () => String(id) });
function fixture(length, start) {
  let nodes = Array.from({ length: length - start }, (_, n) => node(start + n));
  const chat = Array.from({ length }, (_, n) => ({ mes: `message ${n}`, is_system: n % 2 === 0 }));
  const context = { chat, id: 'one' }, loads = [], renders = [], progress = [];
  const options = {
    getContext: () => context, getChatKey: context => context.id, getMessages: () => nodes,
    loadOlder: async count => {
      loads.push(count); const first = nodes.length ? Number(nodes[0].getAttribute()) : chat.length;
      nodes = [...Array.from({ length: Math.min(count, first) }, (_, n) => node(Math.max(0, first - count) + n)), ...nodes];
    },
    renderMessage: async (message, options) => { renders.push(options); nodes.push(node(options.forceId)); },
    yieldToUI: async () => {}, onProgress: text => progress.push(text),
  };
  return { options, context, chat, loads, renders, progress };
}

test('jump loads floor zero in a long chat without changing saved messages or hidden flags', async () => {
  const h = fixture(10050, 10000), before = JSON.stringify(h.chat); let yields = 0;
  h.options.yieldToUI = async () => { yields++; };
  const target = await ensureFloorRendered(0, h.options);
  assert.equal(target.getAttribute(), '0'); assert.equal(h.loads.length, 100);
  assert(h.loads.every(count => count <= 100)); assert.equal(yields, 100);
  assert.equal(h.renders.length, 0); assert.equal(JSON.stringify(h.chat), before);
});

test('jump to an existing target never loads history; omitted middle floor renders at the correct position', async () => {
  const h = fixture(500, 490);
  assert.equal((await ensureFloorRendered(499, h.options)).getAttribute(), '499'); assert.deepEqual(h.loads, []);
  const all = h.options.getMessages(); let visible = all.filter(n => n.getAttribute() !== '495'); h.options.getMessages = () => visible;
  h.options.renderMessage = async (message, options) => { h.renders.push(options); visible = all; };
  await ensureFloorRendered(495, h.options);
  assert.deepEqual(h.renders, [{ forceId: 495, insertBefore: 496, scroll: false }]);
});

test('switching chat or replacing target during loading cancels the jump', async () => {
  for (const mutate of [h => { h.context.id = 'two'; }, h => { h.chat[0] = { mes: 'replacement' }; }]) {
    const h = fixture(250, 200), original = h.options.loadOlder;
    h.options.loadOlder = async count => { await original(count); mutate(h); };
    await assert.rejects(ensureFloorRendered(0, h.options), /切换或改变/);
    assert.equal(h.loads.length, 1);
  }
});

test('invalid floors and stalled host loading fail promptly; retry can succeed', async () => {
  const h = fixture(250, 200);
  for (const id of [-1, 1.5, NaN, 250]) await assert.rejects(ensureFloorRendered(id, h.options), /未找到楼层/);
  assert.equal(h.loads.length, 0);
  const original = h.options.loadOlder; h.options.loadOlder = async () => {};
  await assert.rejects(ensureFloorRendered(0, h.options), /未能加载/);
  h.options.loadOlder = original;
  assert.equal((await ensureFloorRendered(0, h.options)).getAttribute(), '0');
});

test('older hosts can render the exact target without changing global render settings', async () => {
  const h = fixture(250, 200); h.options.loadOlder = null;
  assert.equal((await ensureFloorRendered(10, h.options)).getAttribute(), '10');
  assert.deepEqual(h.renders, [{ forceId: 10, insertBefore: 200, scroll: false }]);
});

function scrollFixture() {
  const style = () => {
    const values = new Map();
    return { getPropertyValue: key => values.get(key)?.value || '', getPropertyPriority: key => values.get(key)?.priority || '',
      setProperty: (key, value, priority = '') => values.set(key, { value, priority }), removeProperty: key => values.delete(key) };
  };
  const container = { scrollTop: 0, scrollHeight: 1000, clientHeight: 100, clientTop: 0, style: style(),
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 300 }) };
  const classes = new Set();
  const target = { hidden: true, isConnected: true, style: style(), classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    getClientRects: () => [{}], getBoundingClientRect: () => ({ top: 600 - container.scrollTop, bottom: 620 - container.scrollTop, height: 20, left: 0, right: 300 }) };
  target.contains = node => node === target; container.contains = node => node === target;
  let closes = 0;
  const options = { container, closeMenu: () => { closes++; }, nextFrame: async () => {}, getStyle: () => ({ display: 'none' }), elementAtPoint: () => target };
  return { container, target, options, classes, closes: () => closes };
}

test('jump closes the menu and moves the actual chat scroll position before reporting success', async () => {
  const h = scrollFixture(); h.container.style.setProperty('scroll-behavior', 'smooth');
  await revealFloorInChat(h.target, h.options);
  assert.equal(h.closes(), 1); assert.equal(h.container.scrollTop, 560);
  assert.equal(h.target.hidden, false); assert.equal(h.target.style.getPropertyValue('display'), 'flex');
  assert.equal(h.target.style.getPropertyPriority('display'), 'important');
  assert(h.classes.has('am-floor-jump-target')); assert.equal(h.container.style.getPropertyValue('scroll-behavior'), 'smooth');
});

test('an obscured or unscrollable target cannot produce a successful jump', async () => {
  const obscured = scrollFixture(); obscured.options.elementAtPoint = () => ({});
  await assert.rejects(revealFloorInChat(obscured.target, obscured.options), /未能滚动/);
  assert(!obscured.classes.has('am-floor-jump-target'));
  const stuck = scrollFixture(); Object.defineProperty(stuck.container, 'scrollTop', { get: () => 0, set() {} });
  await assert.rejects(revealFloorInChat(stuck.target, stuck.options), /未能滚动/);
  assert(!stuck.classes.has('am-floor-jump-target'));
});
