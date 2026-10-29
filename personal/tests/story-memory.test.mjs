import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { parse } = createRequire(import.meta.url)('acorn');
const read = file => fs.readFile(new URL('../../' + file, import.meta.url), 'utf8');
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const bindingsURL = url(await read('personal/chat-memory-bindings.js'));
const binding = await import(bindingsURL);
const story = await import(url((await read('personal/story-memory.js')).replace("'./chat-memory-bindings.js'", JSON.stringify(bindingsURL))));
const recovery = await import(url(await read('personal/recovery.js')));
const ledger = await import(url(await read('personal/ledger.js')));
const names = await import(url(await read('personal/names.js')));
const regeneration = await import(url(await read('personal/regeneration.js')));
const chatSource = await import(url(await read('personal/story-chat-source.js')));

async function harness() {
  const state = { chats: {}, knowledgeBases: { role: {}, _global: {} } }, books = { book: { entries: { 0: { uid: 0, comment: names.SUMMARY_NAME, content: ledger.appendMicroSummaryBlock('', 'A剧情', 1, 30, 128000).content } } } };
  const chats = { A: Array.from({ length: 35 }, (_, n) => ({ mes: `A-${n}`, is_user: false, name: '角色' })), B: Array.from({ length: 35 }, (_, n) => ({ mes: `B-${n}`, is_user: false, name: '角色' })), C: Array.from({ length: 35 }, (_, n) => ({ mes: `C-${n}`, is_user: false, name: '角色' })) };
  let chatId = 'A', generation = 0, failSave = false, failList = false, failVisibility = false, changeOnSave, failRead = false, failGeneration = false, onGenerate, failIngest = false;
  const requests = [], backups = [];
  const ragSettings = { chatMemoryBindings: state, knowledgeBases: state.knowledgeBases };
  const rootSettings = { ngmsEnabled: true, historiographySilent: true, lorebookTarget: 'character_main', historiographySmallAutoEnable: true, historiographySmallTriggerThreshold: 30, historiographyRetentionCount: 5 };
  const ctx = () => ({ characterId: 0, chatId, getCurrentChatId: () => chatId, characters: [{ name: 'role', avatar: 'role.png' }], chat: chats[chatId], getRequestHeaders: () => ({}), extensionSettings: { 'hanlinyuan-rag-core': ragSettings } });
  const chunks = new Map();
  const owner = binding.bindingOwner(ctx());
  const funcs = ['getChatMemoryBindingContext','getMemoryStoryContext','resolveMemoryStoryWorldbook','captureMemoryStoryState','archiveMemoryStory','restoreMemoryStory','bindingFingerprint'];
  const ragSource = await read('core/rag-processor.js'), ast = parse(ragSource, { ecmaVersion: 'latest', sourceType: 'module' });
  const declarations = ast.body.map(n => n.declaration || n).filter(n => n.type === 'FunctionDeclaration' && funcs.includes(n.id.name)).map(n => ragSource.slice(n.start,n.end)).join('\n');
  const ragFixture = { ...binding, ...story, GLOBAL_SCOPE_ID:'_global',getLocalKnowledgeBases:()=>state.knowledgeBases.role,getGlobalKnowledgeBases:()=>state.knowledgeBases._global,getCharacterStableId:()=> 'role',settings: ragSettings, context: ctx(), SillyTavern: { getContext: ctx }, getChatId: () => chatId, saveSettings() {},
    fetch: async (_url, options) => { if (failList) { failList=false; return {ok:false}; } return { ok: true, json: async () => chunks.get(JSON.parse(options.body).collectionId) || [] }; } };
  const keys = Object.keys(ragFixture);
  const rag = new Function(...keys, declarations + ';return {' + funcs.join(',') + '};')(...keys.map(key => ragFixture[key]));
  const fixture = { ...ledger,...names,...recovery,...rag,...regeneration,...story,...chatSource,
    confirmStoryLedgerWrite:async(_context,name,content)=>{assert.equal(names.findActiveSummary(books[name])?.content,content);},
    readStoryChat: async (_context, file) => { if (failRead && file !== chatId) throw new Error('historical chat unavailable'); return chats[file]; },
    extensionName: 'test', extension_settings: { test: rootSettings }, getContext: ctx,
    characters: [{ data: { extensions: { world: 'book' } } }], world_names: ['book'],
    notify: { info() {}, warning(...args) { console.warn(...args); }, error(...args) { console.error(...args); }, success() {} },
    loadWorldInfo: async name => structuredClone(books[name] || null),
    saveWorldInfo: async (name, book) => { if (failSave) { failSave = false; return false; } books[name] = structuredClone(book); if (changeOnSave) { chatId = changeOnSave; changeOnSave = null; } return true; },
    withLoreLock: async (_name, action) => action(), saveLedgerBackup: async (...args) => {backups.push(structuredClone(args));},
    captureMemoryVisibility: () => recovery.captureVisibility(ctx()),
    planMemoryVisibility: (snapshot, progress) => recovery.visibilityPlan(ctx(),snapshot,progress),
    restoreMemoryVisibility: async (snapshot, progress) => { if (failVisibility) { failVisibility=false; throw new Error('visibility failure'); } const flags = recovery.visibilityPlan(ctx(),snapshot,progress); flags.forEach((flag,n) => { chats[chatId][n].is_system = flag; }); },
    captureMemoryKnowledgeState: () => [], restoreMemoryKnowledgeState: () => { throw new Error('new archives must restore exact bindings, not global KB switches'); },
    ingestTextToHanlinyuan: async () => failIngest ? { success: false, error: 'vector save failed' } : { success: true, count: 1 },
    getPresetPrompts: async () => [], getMixedOrder: () => [{type:'conditional',id:'coreContent'}], generateRandomSeed: () => 'seed', timelineReference: () => '',
    callNgmsAI: async messages => { requests.push(messages); if (onGenerate) await onGenerate(messages); if (failGeneration) throw new Error('generation unavailable'); return `generated-${++generation}`; }, executeAutoHide: async () => {}, applyExclusionRules: text => text,
    compatibleWriteToLorebook: async (name, comment, update) => {
      if (failSave) { failSave = false; return false; }
      books[name] ||= { entries: {} }; if (!fixture.world_names.includes(name)) fixture.world_names.push(name);
      const entry = names.findActiveSummary(books[name]);
      if (entry) entry.content = update(entry.content);
      else { const uid = Object.keys(books[name].entries).length; books[name].entries[uid] = { uid, comment, content: update(null) }; }
      return true;
    },
  };
  let source = await read('core/historiographer.js'), tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  globalThis.__storyFixture = fixture;
  globalThis.localStorage = { getItem: () => null }; globalThis.document = { getElementById: () => ({ checked: false }), dispatchEvent() {} };
  for (const node of [...tree.body].reverse()) if (node.type === 'ImportDeclaration') {
    source = source.slice(0,node.start) + node.specifiers.map(spec => `const ${spec.local.name}=globalThis.__storyFixture[${JSON.stringify(spec.imported?.name || 'default')}];`).join('\n') + source.slice(node.end);
  }
  source = source.replace('await import("/scripts/world-info.js")','({reloadEditor:()=>{}})');
  const hist = await import(url(source + '\n//# sourceURL=story-host-test-' + Math.random() + '.js'));
  const add = (id, hashes = [1]) => { chunks.set(id, hashes); state.knowledgeBases.role[id]={id,owner:'role',enabled:true}; // Use explicit collection names in this host fixture.
    ragFixture.getLocalKnowledgeBases=()=>state.knowledgeBases.role;
    binding.updateChatBindings(state,owner,[chatId],[{collectionId:'role_'+id,name:id,hashes:null}]); chunks.set('role_'+id,hashes); };
  return { state, books, chats, rag, hist, owner, chunks, requests, backups, fixture, settings: rootSettings,
    blockReads(value) { failRead = value; }, blockGeneration(value) { failGeneration = value; }, onGenerate(fn) { onGenerate = fn; },
    blockIngest(value) { failIngest = value; },
    change(id) { rag.getMemoryStoryContext(); chatId = id; rag.getMemoryStoryContext(); }, add,
    failSave() { failSave = true; }, changeOnSave(id) { changeOnSave=id; }, failList() { failList = true; }, failVisibility() { failVisibility = true; }, current: () => rag.getMemoryStoryContext().story };
}

test('A archive, B fresh, C automatically inherits B, archive C and restore exact memory with summary', async () => {
  const h = await harness();
  const aBook = await h.hist.getTargetLorebookName(); h.add('A-memory',[1,2]);
  assert.equal(await h.hist.archiveCurrentLedger(),true);
  const archivedA = structuredClone(h.books[aBook].entries[0].amily3Archive);
  h.change('B'); const bBook = await h.hist.getTargetLorebookName(); assert.notEqual(bBook,aBook);
  assert.deepEqual(h.current().references,[]); assert.equal(await h.hist.executeManualSummary(1,30,true),true);
  h.add('B-memory',[11,12]); const bStoryId = h.current().id;
  h.change('C'); assert.equal(h.current().id,bStoryId); assert.equal(await h.hist.getTargetLorebookName(),bBook);
  assert.equal(h.rag.getMemoryStoryContext().chatFile,'C'); assert.equal(h.current().references[0].collectionId,'role_B-memory');
  h.chats.C.push(...Array.from({length:35},()=>({mes:'continued raw message',is_user:false})));
  await h.hist.checkAndTriggerAutoSummary();
  assert(h.requests[0].some(message => /【第 1 楼】/.test(message.content)));
  assert(h.requests[1].some(message => /【第 31 楼】/.test(message.content)));
  assert.match(names.findActiveSummary(h.books[bBook]).content,/【31楼至60楼详细总结记录】/);
  assert.doesNotMatch(names.findActiveSummary(h.books[bBook]).content,/来源聊天文件|MemoryFiles/);
  h.add('C-memory',[21]); assert.equal(await h.hist.archiveCurrentLedger(),true);
  const archive = Object.values(h.books[bBook].entries).find(row=>row.amily3Archive?.story);
  assert.equal(archive.amily3Archive.story.archiveChat,'C');
  assert.deepEqual(archive.amily3Archive.story.references.map(ref=>ref.collectionId),['role_B-memory','role_C-memory']);
  h.chunks.get('B-memory').push(999);
  h.change('A'); const archives = await h.hist.getArchivedLedgers();
  const cArchive = archives.find(item=>item.comment.includes(' · C')); assert(cArchive);
  assert.equal(await h.hist.restoreArchivedLedger(cArchive.key),true);
  assert.equal(await h.hist.getTargetLorebookName(),bBook);
  assert.deepEqual(h.current().references[0].hashes,['11','12']);
  assert(!h.current().references.some(ref=>ref.collectionId==='role_A-memory'));
  assert(h.chats.A.every(message=>message.is_system),'unrelated existing raw messages are hidden on cross-file recovery');
  const requestsBefore = names.findActiveSummary(h.books[bBook]).content;
  await h.hist.checkAndTriggerAutoSummary();
  assert.equal(names.findActiveSummary(h.books[bBook]).content,requestsBefore,'old raw messages are not summarized again after cross-file recovery');
  assert.deepEqual(h.books[aBook].entries[0].amily3Archive, archivedA);
  assert(h.current().id!==bStoryId,'restore creates a branch and preserves old files');
  assert.equal(archive.disable,true,'archive original remains intact');
});

test('failed worldbook archive leaves storyline open and next file still inherits it', async () => {
  const h = await harness(); await h.hist.getTargetLorebookName(); h.add('A-memory');
  h.failSave(); assert.equal(await h.hist.archiveCurrentLedger(),false);
  assert.equal(h.current().archived,false);
  const original = h.current().id; h.change('B'); assert.equal(h.current().id,original);
  assert.equal(h.current().references[0].collectionId,'role_A-memory');
});

test('existing chat-specific bindings migrate separately; inspecting another file never joins a storyline', () => {
  const state = { chats: {} }, owner = 'character:role.png';
  binding.updateChatBindings(state,owner,['old-B'],[{collectionId:'B',hashes:null}]);
  const a = story.enterStory(state,owner,'A',10,()=> 'A-story');
  assert.equal(story.storyForChat(state,owner,'unopened'),null);
  const b = story.enterStory(state,owner,'old-B',15,()=> 'B-story'); assert.notEqual(a.id,b.id);
  story.archiveStory(state,owner,'old-B',{references:structuredClone(b.references)});
  const c = story.enterStory(state,owner,'C',2,()=> 'C-story'); assert.deepEqual(c.references,[]);
});

test('vector snapshot failure does not archive the worldbook or close the storyline', async () => {
  const h = await harness(); const book = await h.hist.getTargetLorebookName(); h.add('A-memory');
  const before = structuredClone(h.books[book]); h.failList();
  assert.equal(await h.hist.archiveCurrentLedger(),false);
  assert.deepEqual(h.books[book],before); assert.equal(h.current().archived,false);
  assert.equal(await h.hist.archiveCurrentLedger(),true);
});

test('failed recovery rolls back both storyline bindings and worldbook, and archived original can be replayed', async () => {
  const h = await harness(); const book = await h.hist.getTargetLorebookName(); h.add('A-memory',[1,2]);
  assert(await h.hist.archiveCurrentLedger());
  const beforeState=structuredClone(h.state), beforeBook=structuredClone(h.books[book]);
  h.failVisibility(); assert.equal(await h.hist.restoreArchivedLedger('0'),false);
  assert.deepEqual(h.state,beforeState); assert.deepEqual(h.books[book],beforeBook);
  assert.equal(await h.hist.restoreArchivedLedger('0'),true);
  assert.equal(h.books[book].entries[0].disable,true);
  assert.equal(await h.hist.restoreArchivedLedger('0'),true);
  assert.equal(h.books[book].entries[0].disable,true);
  assert.deepEqual(h.current().references[0].hashes,['1','2']);
});

test('switching chat while archive save is pending restores the original worldbook and leaves the storyline open', async () => {
  const h = await harness(); const book = await h.hist.getTargetLorebookName(); h.add('A-memory');
  const original = structuredClone(h.books[book]); h.changeOnSave('B');
  assert.equal(await h.hist.archiveCurrentLedger(),false);
  assert.deepEqual(h.books[book],original); assert.equal(h.current().archived,false);
});

test('missing bound hashes cannot silently produce a successful archive', async () => {
  const h = await harness(); await h.hist.getTargetLorebookName(); h.add('A-memory',[1]);
  binding.updateChatBindings(h.state,h.owner,['A'],[{collectionId:'role_A-memory',hashes:['1','missing']}]);
  // Convert an existing whole-library choice to a fixed selection for this check.
  h.current().references[0].hashes=['1','missing'];
  assert.equal(await h.hist.archiveCurrentLedger(),false); assert.equal(h.current().archived,false);
});

function savedLedger(progress) {
  return `【最新大总结｜1-${progress}楼】\n保留的剧情事实\n\n【前${progress}楼篇章编撰已完成】\n\n本条勿动【前${progress}楼总结已完成】否则后续总结无法进行。`;
}
async function rollbackHarness(length=605) {
  const h=await harness();await h.hist.getTargetLorebookName();
  h.chats.A=Array.from({length},(_,n)=>({mes:`raw-floor-${n+1}`,is_user:false,name:'角色'}));h.rag.getMemoryStoryContext();
  h.current().files.A.summarizedThrough=900;h.current().files.A.skipThrough=900;h.current().progress=900;
  h.books.book.entries[0].content=savedLedger(600);
  assert.equal(await h.hist.readGoldenLedgerProgress('book'),600);
  return h;
}

test('editing both worldbook seals from 600 to 570 resumes automatic summary at 571 despite stale file state',async()=>{
  const h=await rollbackHarness();
  h.books.book.entries[0].content=savedLedger(570).replace('保留的剧情事实','来源聊天文件："手动改过的聊天来源.jsonl"；本地第1至570楼。\n保留的剧情事实').replace('本条勿动','<!--MemoryFiles {"A":900,"other":1200} -->\n本条勿动');
  const edited=h.books.book.entries[0].content;
  assert.equal(await h.hist.readGoldenLedgerProgress('book'),570);await h.hist.checkAndTriggerAutoSummary();
  assert.equal(h.requests.length,1);assert(h.requests[0].some(message=>message.content.includes('【第 571 楼】')));
  assert(h.requests[0].some(message=>message.content.includes('raw-floor-600')));
  assert(!h.requests[0].some(message=>message.content.includes('手动改过的聊天来源.jsonl')));
  const saved=names.findActiveSummary(h.books.book).content;assert.match(saved,/【571楼至600楼详细总结记录】/);
  assert.match(saved,/【前570楼篇章编撰已完成】/);assert.match(saved,/保留的剧情事实/);
  assert.doesNotMatch(saved,/来源聊天文件|来源文件|MemoryFiles|MemorySource/);
  assert.equal(await h.hist.readGoldenLedgerProgress('book'),600);
  assert(h.backups.some(args=>args[2].content===edited),'cleanup first backs up the exact manually edited summary');
  assert.equal(h.current().files.A.summarizedThrough,900,'stale values are ignored rather than silently rewritten');
});

test('570 rollback still observes the configured 30-floor batch and five retained floors',async()=>{
  const h=await rollbackHarness(604);h.books.book.entries[0].content=savedLedger(570);
  await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,0);assert.equal(await h.hist.readGoldenLedgerProgress('book'),570);
  h.chats.A.push({mes:'floor-605',is_user:false});await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,1);
  await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,1,'no repeated or short final batch');
});

test('manual batch summary also follows 570 rather than saved per-file progress',async()=>{
  const h=await rollbackHarness();h.books.book.entries[0].content=savedLedger(570);
  await h.hist.executeExpedition();assert.equal(h.requests.length,1);assert.equal(await h.hist.readGoldenLedgerProgress('book'),600);
  assert.match(h.books.book.entries[0].content,/【571楼至600楼详细总结记录】/);
});

test('editing only compilation marker does not change small-summary progress: the terminal seal is authoritative',async()=>{
  const h=await rollbackHarness();h.books.book.entries[0].content=savedLedger(600).replace('前600楼篇章编撰已完成','前570楼篇章编撰已完成');
  assert.equal(await h.hist.readGoldenLedgerProgress('book'),600);await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,0);
});

test('rollback during generation discards the obsolete draft and respects the next 570-based attempt',async()=>{
  const h=await rollbackHarness(635);h.onGenerate(()=>{h.books.book.entries[0].content=savedLedger(570);});
  await h.hist.checkAndTriggerAutoSummary();assert.equal(h.books.book.entries[0].content,savedLedger(570));
  assert.equal(h.requests.length,1);h.onGenerate(null);await h.hist.checkAndTriggerAutoSummary();
  assert.match(h.books.book.entries[0].content,/【571楼至600楼详细总结记录】/);assert.doesNotMatch(h.books.book.entries[0].content,/【601楼至630楼详细总结记录】/);
});

test('generation failure and write failure preserve manually edited 570 and allow retry',async()=>{
  const h=await rollbackHarness();h.books.book.entries[0].content=savedLedger(570);h.blockGeneration(true);
  await h.hist.checkAndTriggerAutoSummary();assert.equal(await h.hist.readGoldenLedgerProgress('book'),570);
  h.blockGeneration(false);h.failSave();await h.hist.checkAndTriggerAutoSummary();assert.equal(await h.hist.readGoldenLedgerProgress('book'),570);
  await h.hist.checkAndTriggerAutoSummary();assert.equal(await h.hist.readGoldenLedgerProgress('book'),600);
});

test('source cleanup runs even below threshold and leaves both edited progress seals unchanged',async()=>{
  const h=await rollbackHarness(570);h.books.book.entries[0].content=savedLedger(570).replace('保留的剧情事实','来源聊天文件："obsolete.jsonl"；本地第1至570楼。\n保留的剧情事实').replace('本条勿动','<!--MemoryFiles {"A":999} -->\n本条勿动');
  await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,0);assert.equal(await h.hist.readGoldenLedgerProgress('book'),570);
  assert.doesNotMatch(h.books.book.entries[0].content,/obsolete.jsonl|MemoryFiles/);assert.match(h.books.book.entries[0].content,/【前570楼篇章编撰已完成】/);
});

test('deleting the active summary never recovers progress from an old file cache',async()=>{
  const h=await rollbackHarness();h.books.book.entries={};assert.equal(await h.hist.readGoldenLedgerProgress('book'),0);
  await h.hist.checkAndTriggerAutoSummary();assert.match(h.books.book.entries[0].content,/【1楼至30楼详细总结记录】/);
});

test('cleanup failure never modifies the retained body or seals',async()=>{
  const h=await rollbackHarness();const edited=savedLedger(570).replace('保留的剧情事实','来源聊天文件："obsolete.jsonl"；本地第1至570楼。\n保留的剧情事实');h.books.book.entries[0].content=edited;h.failSave();
  await assert.rejects(h.hist.checkAndTriggerAutoSummary(),/保存失败/);assert.equal(h.books.book.entries[0].content,edited);assert.equal(h.requests.length,0);
});

test('parser and renderer remove only generated provenance and metadata, retaining ordinary filenames in story text',()=>{
  const text='【最新大总结】\n来源聊天文件："old.jsonl"；本地第1至30楼。\n角色提到了 report.txt，这是剧情事实。\n【以上小总结篇章编撰已完成】\n\n【31楼至60楼详细总结记录】\n来源聊天文件："other.jsonl"；本地第31至60楼；剧情第31至60楼。\n新事件\n<!--MemorySource {"rangeId":"old"} -->\n<!--MemoryFiles {"A":999} -->\n本条勿动【前60楼总结已完成】否则后续总结无法进行。';
  const parsed=ledger.parseLedgerForRefinement(text);assert(parsed.valid);assert.equal(parsed.totalFloors,60);assert.equal(parsed.pendingBlockCount,1);
  const merged=ledger.buildRollingLedgerContent('合并后的新事件',parsed,1);assert.doesNotMatch(merged,/来源聊天文件|old.jsonl|other.jsonl|MemoryFiles|MemorySource/);
  assert.match(merged,/report.txt/);assert.match(merged,/【最新大总结｜31-60楼】/);assert.match(merged,/【前60楼篇章编撰已完成】/);
  assert(ledger.parseLedgerForRefinement(merged).valid);
});

test('actual large-summary save after rollback carries neither provenance nor cached file progress',async()=>{
  const h=await rollbackHarness(635);h.books.book.entries[0].content=savedLedger(570);h.settings.historiographyLargeAutoEvery=2;
  await h.hist.checkAndTriggerAutoSummary();await h.hist.checkAndTriggerAutoSummary();
  const content=h.books.book.entries[0].content;assert.match(content,/【最新大总结｜571-630楼】/);assert.match(content,/【前630楼篇章编撰已完成】/);
  assert.doesNotMatch(content,/来源聊天文件|MemoryFiles|MemorySource/);assert.equal(await h.hist.readGoldenLedgerProgress('book'),630);
});

test('auto hide follows the edited worldbook progress rather than stale per-file completion',async()=>{
  const h=await rollbackHarness();h.books.book.entries[0].content=savedLedger(570);const commands=[];
  const fixture={...recovery,getContext:h.fixture.getContext,extensionName:'test',extension_settings:{test:{autoHideSummarizedEnabled:true}},readGoldenLedgerProgress:h.hist.readGoldenLedgerProgress,getTargetLorebookName:h.hist.getTargetLorebookName,SlashCommandParser:class{parse(command){commands.push(command);return{execute:async()=>{}};}},notify:{info(){},error(){},success(){}}};
  let source=await read('core/autoHideManager.js');const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});globalThis.__hideFixture=fixture;
  for(const node of [...tree.body].reverse())if(node.type==='ImportDeclaration')source=source.slice(0,node.start)+node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__hideFixture[${JSON.stringify(spec.imported?.name||'default')}];`).join('\n')+source.slice(node.end);
  const hide=await import(url(source+'\n//# sourceURL=worldbook-hide-test.js'));await hide.executeAutoHide();assert.deepEqual(commands,['/hide 0-569']);
});

test('new summaries preserve source and worldbook edit guards without writing filenames',async()=>{
  const h=await rollbackHarness();h.books.book.entries[0].content=savedLedger(570);h.onGenerate(()=>{h.chats.A[570].mes='edited raw';});
  await h.hist.checkAndTriggerAutoSummary();assert.equal(await h.hist.readGoldenLedgerProgress('book'),570);
  h.onGenerate(null);await h.hist.checkAndTriggerAutoSummary();assert.equal(await h.hist.readGoldenLedgerProgress('book'),600);
  assert(!h.requests.at(-1).some(message=>message.content.includes('来源文件 "A"')));
});

test('legacy independent-chat toggle cannot change current collection selection or remove existing bindings', async () => {
  const source=await read('core/rag-processor.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const node=tree.body.map(node=>node.declaration||node).find(node=>node.type==='FunctionDeclaration'&&node.id.name==='getCollectionId');
  const settings={retrieval:{independentChatMemoryEnabled:true},chatMemoryBindings:{chats:{old:[{collectionId:'preserved',hashes:null}]}}};
  const before=structuredClone(settings.chatMemoryBindings);
  const get=new Function('settings','lockedCollectionId','getDynamicCollectionId',source.slice(node.start,node.end)+';return getCollectionId;')(settings,null,async()=> 'same-collection');
  assert.equal(await get(),'same-collection');settings.retrieval.independentChatMemoryEnabled=false;assert.equal(await get(),'same-collection');
  assert.deepEqual(settings.chatMemoryBindings,before);
  const html=await read('assets/memory-knowledge/hanlinyuan.html');assert.doesNotMatch(html,/hly-independent-chat-memory|独立聊天记忆/);
});
