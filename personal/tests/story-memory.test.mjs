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
  const requests = [];
  const ragSettings = { chatMemoryBindings: state, knowledgeBases: state.knowledgeBases };
  const rootSettings = { ngmsEnabled: true, historiographySilent: true, lorebookTarget: 'character_main', historiographySmallAutoEnable: true, historiographySmallTriggerThreshold: 30, historiographyRetentionCount: 5 };
  const ctx = () => ({ characterId: 0, chatId, getCurrentChatId: () => chatId, characters: [{ name: 'role', avatar: 'role.png' }], chat: chats[chatId], getRequestHeaders: () => ({}), extensionSettings: { 'hanlinyuan-rag-core': ragSettings } });
  const chunks = new Map();
  const owner = binding.bindingOwner(ctx());
  const funcs = ['getChatMemoryBindingContext','getMemoryStoryContext','syncMemoryStoryProgress','resolveMemoryStoryWorldbook','noteMemoryStoryProgress','captureMemoryStoryState','archiveMemoryStory','restoreMemoryStory','bindingFingerprint'];
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
    withLoreLock: async (_name, action) => action(), saveLedgerBackup: async () => {},
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
  return { state, books, chats, rag, hist, owner, chunks, requests, fixture, settings: rootSettings,
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
  await h.hist.checkAndTriggerAutoSummary();
  assert(h.requests[0].some(message => /来源文件 "B"｜第 1 楼/.test(message.content)));
  assert(h.requests[1].some(message => /来源文件 "C"｜第 1 楼/.test(message.content)));
  assert(h.requests[2].some(message => /来源文件 "B"｜第 31 楼/.test(message.content)));
  assert.match(names.findActiveSummary(h.books[bBook]).content,/来源聊天文件："C"；本地第1至30楼。/);
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

async function continuingChats() {
  const h = await harness();
  await h.hist.getTargetLorebookName(); assert(await h.hist.archiveCurrentLedger());
  h.change('B'); const book = await h.hist.getTargetLorebookName();
  assert(await h.hist.executeManualSummary(1,30,true)); h.change('C');
  return { h, book };
}

test('returning to B keeps local floors and progress independent of C without continuation ranges', async () => {
  const {h,book}=await continuingChats();await h.hist.checkAndTriggerAutoSummary();h.change('B');
  h.chats.B.push({mes:'new B floor 36',is_user:false});h.rag.getMemoryStoryContext();
  assert(await h.hist.executeManualSummary(36,36,true));assert.equal(story.storySummarizedPrefix(h.current(),'B'),36);
  assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);
  const content=names.findActiveSummary(h.books[book]).content;assert.match(content,/来源聊天文件："B"；本地第36至36楼。/);assert.doesNotMatch(content,/剧情第|消息标识|71楼/);
  assert.equal(h.current().segments,undefined);const restored=JSON.parse(JSON.stringify(h.state));
  assert.equal(story.storySummarizedPrefix(story.enterStory(restored,h.owner,'C',35),'C'),30);
});

test('old B short tail is summarized even when new C is empty', async () => {
  const {h,book}=await continuingChats();h.chats.C.length=0;await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,2);
  assert.match(names.findActiveSummary(h.books[book]).content,/来源聊天文件："B"；本地第31至35楼。/);assert.equal(h.fixture.getContext().chatId,'C');
  await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,2);
});

test('unavailable B history cannot block C and retries never regenerate saved C summaries', async () => {
  const {h,book}=await continuingChats();h.blockReads(true);await h.hist.checkAndTriggerAutoSummary();
  assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);assert.equal(story.storySummarizedPrefix(h.current(),'B'),30);assert.equal(h.requests.length,2);
  h.blockReads(false);await h.hist.checkAndTriggerAutoSummary();assert.equal(h.requests.length,3);assert.equal(story.storySummarizedPrefix(h.current(),'B'),35);
  assert.equal((names.findActiveSummary(h.books[book]).content.match(/来源聊天文件："C"；本地第1至30楼。/g)||[]).length,1);
});

test('manual C summary never reads or waits for unfinished B', async () => {
  const {h}=await continuingChats();h.settings.historiographySmallAutoEnable=false;h.blockReads(true);assert(await h.hist.executeManualSummary(1,30,true));
  assert.equal(h.requests.length,2);assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);assert.equal(story.storySummarizedPrefix(h.current(),'B'),30);
});

test('failed B save leaves B pending and retries without duplicate chapters', async () => {
  const {h,book}=await continuingChats();assert(await h.hist.executeManualSummary(1,30,true));h.failSave();await h.hist.checkAndTriggerAutoSummary();
  assert.equal(story.storySummarizedPrefix(h.current(),'B'),30);await h.hist.checkAndTriggerAutoSummary();assert.equal(story.storySummarizedPrefix(h.current(),'B'),35);
  assert.equal((names.findActiveSummary(h.books[book]).content.match(/来源聊天文件："B"；本地第31至35楼。/g)||[]).length,1);
});

test('editing B during generation rejects stale B while C stays saved', async () => {
  const {h}=await continuingChats();h.onGenerate(messages=>{if(messages.some(message=>message.content.includes('B-30')))h.chats.B[30].mes='edited B tail';});
  await h.hist.checkAndTriggerAutoSummary();assert.equal(story.storySummarizedPrefix(h.current(),'B'),30);assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);
  h.onGenerate(null);await h.hist.checkAndTriggerAutoSummary();assert.equal(story.storySummarizedPrefix(h.current(),'B'),35);assert(h.requests.at(-1).some(message=>message.content.includes('edited B tail')));
});

test('legacy cumulative progress migrates to B and C local cursors without skipping B tail', () => {
  const s={id:'old',references:[],segments:{B:{offset:0,length:35},C:{offset:35,length:35}},progress:65};
  const old='【1楼至30楼详细总结记录】\n来源聊天文件："B"；本地第1至30楼；剧情第1至30楼。\nB summary\n【36楼至65楼详细总结记录】\n来源聊天文件："C"；本地第1至30楼；剧情第36至65楼。\nC summary\n本条勿动【前65楼总结已完成】否则后续总结无法进行。';
  story.syncStoryProgress(s,old);assert.equal(story.storySummarizedPrefix(s,'B'),30);assert.equal(story.storySummarizedPrefix(s,'C'),30);
  assert.deepEqual(story.storySummaryBatch(s,'B',30),{chatFile:'B',startFloor:31,endFloor:35});
});

test('per-file progress footer survives settings reload and merging B/C summaries', async () => {
  const {h,book}=await continuingChats();await h.hist.checkAndTriggerAutoSummary();const parsed=ledger.parseLedgerForRefinement(names.findActiveSummary(h.books[book]).content);assert(parsed.fileProgress);
  const merged=ledger.buildRollingLedgerContent('merged B/C facts',parsed,parsed.pendingBlockCount);assert.match(merged,/【最新大总结】/);assert.doesNotMatch(merged,/最新大总结｜/);
  const reparsed=ledger.parseLedgerForRefinement(merged);assert(reparsed.valid);assert(reparsed.latest.fileScoped);assert.deepEqual(new Set(reparsed.latest.sources.map(source=>source.chatFile)),new Set(['B','C']));
  const reload={id:'reload',files:{B:{length:35,summarizedThrough:0,initialized:true},C:{length:35,summarizedThrough:0,initialized:true}}};story.syncStoryProgress(reload,merged);
  assert.equal(reload.files.B.summarizedThrough,35);assert.equal(reload.files.C.summarizedThrough,30);
  const again=ledger.renderIndependentLedger({...reparsed,latest:reparsed.latest,pending:reparsed.pendingMicroContent});assert.equal(again,merged);
});

test('B hiding uses its own local progress and leaves new B floor visible', async () => {
  const {h}=await continuingChats();await h.hist.checkAndTriggerAutoSummary();h.change('B');h.chats.B.push({mes:'new B floor',is_user:false});h.rag.getMemoryStoryContext();const commands=[];
  const fixture={...recovery,...story,...h.rag,getContext:h.fixture.getContext,extensionName:'test',extension_settings:{test:{autoHideSummarizedEnabled:true}},readGoldenLedgerProgress:h.hist.readGoldenLedgerProgress,getTargetLorebookName:h.hist.getTargetLorebookName,SlashCommandParser:class{parse(command){commands.push(command);return{execute:async()=>{}};}},notify:{info(){},error(){},success(){}}};
  let source=await read('core/autoHideManager.js');const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});globalThis.__hideFixture=fixture;
  for(const node of [...tree.body].reverse())if(node.type==='ImportDeclaration')source=source.slice(0,node.start)+node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__hideFixture[${JSON.stringify(spec.imported?.name||'default')}];`).join('\n')+source.slice(node.end);
  const hide=await import(url(source+'\n//# sourceURL=local-hide-test.js'));await hide.executeAutoHide();assert.deepEqual(commands,['/hide 0-34']);
});

test('returned B archive restores B local progress and retains independent C progress', async () => {
  const {h,book}=await continuingChats();await h.hist.checkAndTriggerAutoSummary();h.change('B');h.chats.B.push({mes:'B appended',is_user:false});h.rag.getMemoryStoryContext();assert(await h.hist.executeManualSummary(36,36,true));
  assert(await h.hist.archiveCurrentLedger());const [key]=Object.entries(h.books[book].entries).find(([,entry])=>entry.amily3Archive?.story?.archiveChat==='B');assert(await h.hist.restoreArchivedLedger(key));
  assert.equal(await h.hist.readGoldenLedgerProgress(book),36);assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);
});

test('no storage destination stops once and vector-only progress advances only on success', async () => {
  const {h}=await continuingChats();Object.assign(h.settings,{historiographyWriteToLorebook:false,historiographyIngestToRag:false});assert.equal(await h.hist.executeManualSummary(1,30,true),false);assert.equal(h.requests.length,2);
  h.settings.historiographyIngestToRag=true;h.blockIngest(true);assert.equal(await h.hist.executeManualSummary(1,30,true),false);assert.equal(story.storySummarizedPrefix(h.current(),'C'),0);
  h.blockIngest(false);assert(await h.hist.executeManualSummary(1,30,true));assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);
});

test('manual B range can include its pending tail and appended messages together without finishing C', async () => {
  const {h,book}=await continuingChats();assert(await h.hist.executeManualSummary(1,30,true));h.change('B');h.chats.B.push({mes:'B new local 36',is_user:false});h.rag.getMemoryStoryContext();
  assert(await h.hist.executeManualSummary(31,36,true));assert.equal(story.storySummarizedPrefix(h.current(),'B'),36);assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);
  assert.match(names.findActiveSummary(h.books[book]).content,/来源聊天文件："B"；本地第31至36楼。/);
});

test('actual automatic large-summary path preserves B/C sources and file progress across subsequent large summaries', async () => {
  const {h,book}=await continuingChats();h.settings.historiographyLargeAutoEvery=2;
  assert(await h.hist.executeManualSummary(1,30,true));
  let parsed=ledger.parseLedgerForRefinement(names.findActiveSummary(h.books[book]).content);
  assert(parsed.latest.fileScoped);assert.deepEqual(new Set(parsed.latest.sources.map(source=>source.chatFile)),new Set(['B','C']));
  assert.equal(story.storySummarizedPrefix(h.current(),'B'),30);assert.equal(story.storySummarizedPrefix(h.current(),'C'),30);
  await h.hist.checkAndTriggerAutoSummary();assert(await h.hist.executeManualSummary(31,35,true));
  parsed=ledger.parseLedgerForRefinement(names.findActiveSummary(h.books[book]).content);
  assert.equal(parsed.history.length,1);assert(parsed.history[0].fileScoped);assert(parsed.fileProgress);
  assert.equal(parsed.pendingBlockCount,0);assert.equal(story.storySummarizedPrefix(h.current(),'C'),35);
  assert(h.requests.some(messages=>messages.some(message=>message.content.includes('不要相加或改编成全局楼层'))));
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
