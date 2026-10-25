import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { parse } = require('acorn');
const read = file => fs.readFile(new URL('../../' + file, import.meta.url), 'utf8');
const load = text => import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
const bindings = await load(await read('personal/chat-memory-bindings.js'));

test('multi-chat bindings merge selected hashes, remove independently and survive serialization', () => {
  let state = { enabled: true, chats: {} };
  bindings.updateChatBindings(state, 'avatar:a', ['one', 'two'], [{ collectionId: 'old', name: '旧记忆', hashes: [1, '1', 2] }]);
  bindings.updateChatBindings(state, 'avatar:a', ['one'], [{ collectionId: 'old', hashes: [3] }]);
  state = JSON.parse(JSON.stringify(state));
  assert.deepEqual(bindings.chatBindings(state, 'avatar:a', 'one')[0].hashes, ['1', '2', '3']);
  assert.deepEqual(bindings.chatBindings(state, 'avatar:a', 'two')[0].hashes, ['1', '2']);
  bindings.updateChatBindings(state, 'avatar:a', ['one'], [{ collectionId: 'old', hashes: [1, 2] }], true);
  assert.deepEqual(bindings.chatBindings(state, 'avatar:a', 'one')[0].hashes, ['3']);
  assert.deepEqual(bindings.chatBindings(state, 'avatar:a', 'two')[0].hashes, ['1', '2']);
  assert.deepEqual(bindings.chatBindings(state, 'avatar:b', 'one'), []);
  assert.deepEqual(bindings.chatBindings(state, 'avatar:a', 'brand-new-chat'), []);
});

test('whole-library binding, explicit empty bindings and atomic failure preserve data', () => {
  const state = { enabled: true, chats: {} };
  bindings.updateChatBindings(state, 'a', ['first'], [{ collectionId: 'kb', hashes: null }]);
  bindings.updateChatBindings(state, 'a', ['second'], [{ collectionId: 'kb', hashes: [1, 2] }]);
  const before = JSON.stringify(state);
  assert.throws(() => bindings.updateChatBindings(state, 'a', ['second', 'first'], [{ collectionId: 'kb', hashes: [1] }], true), /整库绑定/);
  assert.equal(JSON.stringify(state), before, 'failed multi-chat updates cannot partially save');
  bindings.updateChatBindings(state, 'a', ['first'], [{ collectionId: 'kb', hashes: [8] }]);
  assert.equal(bindings.chatBindings(state, 'a', 'first')[0].hashes, null);
  bindings.updateChatBindings(state, 'a', ['first'], [{ collectionId: 'kb', hashes: null }], true);
  assert.deepEqual(bindings.chatBindings(state, 'a', 'first'), []);
});

test('bindings are keyed by character avatar and group, not character display name', () => {
  const ctx = { characterId: 0, characters: [{ name: 'same', avatar: 'a.png' }] };
  assert.equal(bindings.bindingOwner(ctx), 'character:a.png');
  ctx.characters[0].avatar = 'b.png';
  assert.equal(bindings.bindingOwner(ctx), 'character:b.png');
  ctx.groupId = 'group-one'; assert.equal(bindings.bindingOwner(ctx), 'group:group-one');
  assert.equal(bindings.bindingOwner({}), null);
});

async function harness() {
  const source = await read('core/rag-processor.js'), ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = ['resolveRetrievalBases', 'queryVectors', '_executeQueryForBase', 'getChatMemoryBindingContext', 'bindingFingerprint', 'rearrangeChat', 'addKnowledgeBase', 'getMemoryBindingReference'];
  const funcs = ast.body.map(node => node.declaration || node).filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)).map(node => source.slice(node.start, node.end)).join('\n');
  const defaults = (await load(await read('core/rag-settings.js'))).defaultSettings;
  const settings = structuredClone(defaults);
  Object.assign(settings, { settingsVersion: 2, queryPreprocessing: { enabled: false } });
  settings.retrieval.enabled = true; settings.chatMemoryBindings.enabled = true;
  settings.advanced.maxResults = 1;
  let chatId = 'one';
  const context = { characterId: 0, characters: [{ avatar: 'a.png' }], getRequestHeaders: () => ({}) };
  const local = { a: { id: 'a', name: 'A', enabled: true, source: 'chat_history' }, disabled: { id: 'disabled', name: 'disabled', enabled: false } };
  const global = { b: { id: 'b', name: 'B', owner: 'another', enabled: true, source: 'chat_history' } };
  const requests = [], injections = [];
  const rows = [{ hash: 2, text: '<聊天记录>unbound high score', score: .99 }, { hash: 1, text: '<聊天记录>bound lower score', score: .7 }];
  let afterQuery;
  const fixture = { ...bindings, GLOBAL_SCOPE_ID: '_global', settings, context,
    SillyTavern: { getContext: () => context }, getCharacterStableId: () => 'char', getChatId: () => chatId,
    getLocalKnowledgeBases: () => local, getGlobalKnowledgeBases: () => global, getDynamicCollectionId: async () => 'legacy',
    getEmbeddings: async () => [[.1, .2]], saveSettings: () => {}, getRecoveryRevision: () => 0, isMemoryRecovering: () => false,
    executeGraphRetrieval: async () => '', setExtensionPrompt: (key, text) => injections.push({ key, text }),
    rerankResults: async rows => ({ results: rows }), superSort: rows => rows, showNotification: () => {},
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({ url, body });
      if (url.endsWith('/query')) afterQuery?.();
      return { ok: true, json: async () => url.endsWith('/list') ? rows.map(row => row.hash) : { metadata: rows.slice(0, body.topK) } };
    }, console: { log() {}, warn() {}, error(error) { throw new Error(String(error)); } },
  };
  const keys = Object.keys(fixture);
  const api = new Function(...keys, funcs + ';return {resolveRetrievalBases,queryVectors,rearrangeChat,addKnowledgeBase};')(...keys.map(key => fixture[key]));
  const bind = (refs, chat = chatId) => bindings.updateChatBindings(settings.chatMemoryBindings, bindings.bindingOwner(context), [chat], refs);
  return { api, settings, requests, injections, local, global, bind, changeChat: id => { chatId = id; }, onQuery: callback => { afterQuery = callback; } };
}

test('real query excludes unbound local/global/legacy data and keeps lower-ranked bound blocks', async () => {
  const h = await harness();
  assert.deepEqual(await h.api.queryVectors('query'), []); assert.equal(h.requests.length, 0);
  h.bind([{ collectionId: 'char_a', hashes: ['1'] }, { collectionId: 'char_disabled', hashes: null }]);
  const results = await h.api.queryVectors('query');
  assert.equal(results.length, 1); assert.match(results[0].text, /bound lower/);
  assert.deepEqual(h.requests.map(r => r.body.collectionId), ['char_a', 'char_a']);
  assert.equal(h.requests[1].body.topK, 2, 'read all candidates before filtering selected hashes');
  h.requests.length = 0;
  assert.deepEqual(await h.api.queryVectors('query', { includeBases: [{ collectionId: 'another_b' }] }), []);
  assert.equal(h.requests.length, 0, 'explicit priority groups cannot bypass bindings');
  h.changeChat('fresh'); assert.deepEqual(await h.api.queryVectors('query'), []);
});

test('real priority and ordinary injection obey the same per-chat binding', async () => {
  for (const priority of [false, true]) {
    const h = await harness(); h.bind([{ collectionId: 'another_b', hashes: ['1'] }]);
    h.settings.rerank.priorityRetrieval.enabled = priority;
    h.settings.rerank.priorityRetrieval.sources.chat_history.enabled = true;
    await h.api.rearrangeChat([{ is_user: true, mes: 'query' }]);
    assert(h.injections.some(item => item.text.includes('bound lower')));
    assert(!h.injections.some(item => item.text.includes('unbound high')));
    assert(h.requests.every(item => item.body.collectionId === 'another_b'), 'bound global collection retains its original owner');
    h.requests.length = 0; h.injections.length = 0; h.changeChat('fresh');
    await h.api.rearrangeChat([{ is_user: true, mes: 'query' }]);
    assert.equal(h.requests.length, 0); assert(!h.injections.some(item => item.text));
  }
});

test('switching chats during retrieval discards results; newly imported memories bind only to their creating chat', async () => {
  const h = await harness(); h.bind([{ collectionId: 'char_a', hashes: null }]);
  h.onQuery(() => h.changeChat('fresh'));
  await h.api.rearrangeChat([{ is_user: true, mes: 'query' }]);
  assert(!h.injections.some(item => item.text));
  const base = h.api.addKnowledgeBase('新聊天的总结', 'lorebook');
  assert((await h.api.resolveRetrievalBases()).some(item => item.id === base.id));
  h.changeChat('one'); assert(!(await h.api.resolveRetrievalBases()).some(item => item.id === base.id));
});

test('saved bindings always apply even when the old opt-in flag was off', async () => {
  const h = await harness(); h.settings.chatMemoryBindings.enabled = false;
  h.bind([{ collectionId: 'char_a', hashes: ['1'] }]);
  assert.deepEqual((await h.api.resolveRetrievalBases()).map(b => b.collectionId), ['char_a']);
  h.settings.retrieval.independentChatMemoryEnabled = true;
  assert.deepEqual((await h.api.resolveRetrievalBases()).map(b => b.collectionId), ['char_a']);
  h.changeChat('fresh'); assert.deepEqual(await h.api.resolveRetrievalBases(), []);
});
