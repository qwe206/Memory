import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { parse } = createRequire(import.meta.url)('acorn');
const source = await fs.readFile(new URL('../background-memory.js', import.meta.url), 'utf8');
const { createBackgroundMemoryQueue } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const turn = () => new Promise(resolve => setImmediate(resolve));

test('ST message event returns before a blocked summary, subsequent chat replies still finish', async () => {
  let release, started = 0, finished = 0, hostReplies = 0;
  const tasks = [], errors = [];
  const listener = createBackgroundMemoryQueue({
    run: async () => { started++; await new Promise(resolve => { release = resolve; }); finished++; },
    onError: error => errors.push(error), schedule: task => tasks.push(task),
  });
  const hostMessage = async () => { await listener(); hostReplies++; };
  await hostMessage(); assert.equal(hostReplies, 1); assert.equal(started, 0);
  const job = tasks.shift()(); await turn(); assert.equal(started, 1);
  await hostMessage(); await hostMessage(); assert.equal(hostReplies, 3); assert.equal(finished, 0);
  assert.equal(tasks.length, 0, 'no overlapping summaries');
  release(); await job;
  assert.equal(tasks.length, 1, 'incoming replies coalesce into one follow-up check');
  const followup = tasks.shift()(); await turn(); release(); await followup;
  assert.equal(started, 2); assert.equal(finished, 2); assert.equal(tasks.length, 0); assert.deepEqual(errors, []);
});

test('background summary failures are caught and later events can retry', async () => {
  let attempts = 0; const tasks = [], errors = [];
  const listener = createBackgroundMemoryQueue({ run: async () => { attempts++; throw new Error('offline'); },
    onError: error => errors.push(error.message), schedule: task => tasks.push(task) });
  assert.equal(listener(), undefined); listener(); listener(); assert.equal(tasks.length, 1);
  await tasks.shift()(); assert.equal(attempts, 1); assert.deepEqual(errors, ['offline']);
  listener(); await tasks.shift()(); assert.equal(attempts, 2);
});

test('ST preset summary requests keep the active profile and cancellation isolated', async () => {
  const source = await fs.readFile(new URL('../summary-preset-request.js', import.meta.url), 'utf8');
  const { requestSummaryPreset } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const chatController = new AbortController(), requests = [];
  const context = { extensionSettings: { connectionManager: { selectedProfile: 'chat', profiles: [{ id: 'summary' }, { id: 'chat' }] } },
    ConnectionManagerRequestService: { sendRequest(...args) { requests.push(args); return Promise.resolve({ content: 'summary result' }); } } };
  await Promise.all([requestSummaryPreset(context, 'summary', [{ role: 'user', content: 'first' }], { maxTokens: 120 }),
    requestSummaryPreset(context, 'summary', [{ role: 'user', content: 'second' }])]);
  assert.equal(context.extensionSettings.connectionManager.selectedProfile, 'chat');
  assert.equal(requests[0][0], 'summary'); assert.equal(requests[0][2], 120);
  assert.equal(requests[0][3].stream, false); assert.equal(requests[0][3].includePreset, true);
  assert.notEqual(requests[0][3].signal, requests[1][3].signal);
  chatController.abort(); assert(!requests[0][3].signal.aborted);
  await assert.rejects(requestSummaryPreset(context, 'missing', []), /未找到/);
});

test('actual Memory event handler leaves ST reply completion free and skips hiding after a chat switch', async () => {
  const main = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
  const tree = parse(main, { ecmaVersion: 'latest', sourceType: 'module' });
  const handler = tree.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(d => d.id.name === 'afterMessage'));
  assert(handler);
  assert.match(main, /eventSource\.on\(event_types\.MESSAGE_RECEIVED, afterMessage\)/);
  let release, started = 0, hides = 0, chat = 'one', hostCompleted = 0;
  const summary = async () => { started++; await new Promise(resolve => { release = resolve; }); };
  const afterMessage = new Function('createBackgroundMemoryQueue', 'chatKey', 'getContext', 'checkAndTriggerAutoSummary', 'executeAutoHide', 'getMemoryStoryContext',
    main.slice(handler.start, handler.end) + ';return afterMessage;')(createBackgroundMemoryQueue, context => context.id,
    () => ({ id: chat }), summary, async () => { hides++; }, () => ({}));
  await afterMessage(); hostCompleted++;
  while (!started) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(hostCompleted, 1); assert.equal(hides, 0);
  chat = 'two'; release(); await turn();
  assert.equal(hides, 0, 'old-chat summary must not run hide against the newly opened chat');
});
