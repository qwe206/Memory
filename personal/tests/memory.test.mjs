import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {parse}=require('acorn');
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=name=>fs.readFile(path.join(root,name),'utf8');
const load=text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const ledger=await load(await read('personal/ledger.js'));
const features=await load(await read('personal/features.js'));
const names=await load(await read('personal/names.js'));
const recovery=await load(await read('personal/recovery.js'));
const regeneration=await load(await read('personal/regeneration.js'));
function append(content,start){for(let i=0;i<3;i++)content=ledger.appendMicroSummaryBlock(content,`new-${start+i*30}`,start+i*30,start+i*30+29,128000).content;return content;}
function oldLedger({placeholder=false}={}) {
 const prior=placeholder ? 'AI你好，以上内容为rag向量化后注入的相关剧情，以下内容是已发生的剧情回顾。\n\n（前60楼聊天记录总结已由翰林院向量化注入。）\n\n【以下内容为60楼以后的总结内容】\n\n---\n\nold-61-120' : '以下内容是【1楼-120楼】已发生的剧情回顾。\n\n---\n\nold-1-60\n\n===【截止至第60楼的宏史卷】===\n\nold-61-120';
 return prior+'\n\n【前120楼篇章编撰已完成】\n\n---\n\n【121楼至150楼详细总结记录】\nsmall-121-150\n\n本条勿动【前150楼总结已完成】否则后续总结无法进行。';
}
async function harness(vectorize=false){
 const h={book:{entries:{7:{uid:7,comment:'【敕史局】对话流水总帐',content:append('',1)},9:{content:'unrelated'}}},requests:[],backups:[],vectorize,ingest:async()=>({success:true,count:1})};
 h.chat=Array.from({length:245},()=>({mes:'原始对话',is_user:false}));
 h.bases=[];
 const fixture={...ledger,...names,...recovery,...regeneration,timelineReference:()=>'',notify:{info(){},warning(){},error(){},success(){}},extensionName:'test',extension_settings:{test:{ngmsEnabled:true,historiographySilent:true}},getContext:()=>({characterId:0,chatId:h.chatId || 'original-chat',chat:h.chat,name1:'用户',name2:'角色'}),characters:[],world_names:['book'],
  loadWorldInfo:async()=>structuredClone(h.book),saveWorldInfo:async(_,book)=>{h.book=structuredClone(book);if(h.failWorldSave){h.failWorldSave=false;return false;}},saveBook:async(_,book)=>{h.book=structuredClone(book)},withLoreLock:async(_,fn)=>fn(),getChatIdentifier:async()=> 'char-preview',
  saveLedgerBackup:async(...args)=>{if(h.failBackup)throw new Error('quota');h.backups.push(args)},
  getPresetPrompts:async()=>[],getMixedOrder:()=>[{type:'conditional',id:'coreContent'}],generateRandomSeed:()=> 'seed',
  callNgmsAI:async messages=>{h.requests.push(messages);if(h.failGeneration)throw Error('generation failed');return `macro-${h.requests.length}`},
  showSummaryModal:(text,callbacks)=>{h.firstDraft=text;h.regenerate=options=>callbacks.onRegenerate(null,options);h.confirm=async()=>{const result=await callbacks.onConfirm(text);if(result!==false)callbacks.onSaved?.();return result;};h.cancel=()=>callbacks.onCancel?.()},ingestTextToHanlinyuan:(...args)=>h.ingest(...args),
  compatibleWriteToLorebook:async(book,name,update)=>{h.writeTarget={book,name};if(h.failWrite)return false;h.book.entries[7].content=update(h.book.entries[7].content);return true;},
  executeAutoHide:()=>{},extractBlocksByTags:()=>[],applyExclusionRules:text=>text,
 };
 fixture.captureMemoryVisibility=()=>recovery.captureVisibility(fixture.getContext());
 fixture.planMemoryVisibility=(snapshot,progress)=>recovery.visibilityPlan(fixture.getContext(),snapshot,progress);
 fixture.restoreMemoryVisibility=async(snapshot,progress)=>{if(h.failVisibility){h.failVisibility=false;throw Error('visibility failed');}const flags=fixture.planMemoryVisibility(snapshot,progress);flags.forEach((flag,index)=>h.chat[index].is_system=flag);};
 fixture.captureMemoryKnowledgeState=book=>recovery.captureKnowledgeState(h.bases,book);
 fixture.restoreMemoryKnowledgeState=(book,snapshot,progress)=>{const before=structuredClone(h.bases);const plan=recovery.knowledgeRestorePlan(h.bases,book,snapshot,progress);plan.forEach(({base,enabled})=>base.enabled=enabled);return{disabled:plan.filter(item=>!item.enabled).length,undo:()=>{h.bases=before;}}};
 h.settings=fixture.extension_settings.test;h.fixture=fixture;
 globalThis.__fixture=fixture;
 globalThis.toastr={info(){},warning(){},error(){},success(){}};
 globalThis.localStorage={getItem:()=>null};
 globalThis.document={getElementById:()=>({checked:h.vectorize})};
 let source=await read('core/historiographer.js');const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 for(const node of [...tree.body].reverse())if(node.type==='ImportDeclaration'){
  const replacement=node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__fixture[${JSON.stringify(spec.imported?.name||'default')}];`).join('\n');
  source=source.slice(0,node.start)+replacement+source.slice(node.end);
 }
 source=source.replace('await import("/scripts/world-info.js")','({reloadEditor:()=>{}})');
 h.module=await load(source+'\n//# sourceURL=memory-harness-'+Math.random()+'.js');
 h.preview=async()=>{h.settings.historiographySilent=false;h.confirm=null;h.pending=h.module.executeRefinement('book',7);await new Promise(resolve=>setImmediate(resolve));assert.ok(h.confirm,'original preview shown');};
 h.merge=async()=>{await h.preview();await h.confirm();await h.pending;};return h;
}
test('old Amily cumulative and vector-placeholder ledgers preserve ranges and never invent missing text',()=>{
 const parsed=ledger.parseLedgerForRefinement(oldLedger().replaceAll('\n','\r\n')+'\r\n');
 assert(parsed.valid);assert.equal(parsed.totalFloors,150);assert.equal(parsed.pendingBlockCount,1);
 assert.deepEqual(parsed.history,[{startFloor:1,endFloor:60,text:'old-1-60'}]);
 assert.deepEqual(parsed.latest,{startFloor:61,endFloor:120,text:'old-61-120'});
 const placeholder=ledger.parseLedgerForRefinement(oldLedger({placeholder:true}));
 assert(placeholder.valid);assert.equal(placeholder.missingHistoryThrough,60);assert.equal(placeholder.latest.startFloor,61);
 const content=ledger.renderIndependentLedger({...placeholder,pending:placeholder.pendingMicroContent});
 const reloaded=ledger.parseLedgerForRefinement(content);assert(reloaded.valid);assert.equal(reloaded.missingHistoryThrough,60);assert.equal(reloaded.latest.text,'old-61-120');
 assert(!ledger.parseLedgerForRefinement(oldLedger().replace('截止至第60楼','截止至第200楼')).valid);
 assert(!ledger.parseLedgerForRefinement('AI你好，以上内容为rag向量化后注入的相关剧情\n本条勿动【前150楼总结已完成】否则后续总结无法进行。').valid);
});

test('old Amily summary continues in the original row, merges only new small text and keeps history',async()=>{
 const h=await harness();h.settings.lorebookTarget='dedicated';h.fixture.world_names.push('Amily2-Lore-char-preview');
 h.book.entries[7].content=oldLedger();const original=h.book.entries[7].content;
 assert.equal(await h.module.readGoldenLedgerProgress('Amily2-Lore-char-preview'),150);
 assert.equal(h.book.entries[7].content,original,'read must not migrate the book');
 await h.merge();const parsed=ledger.parseLedgerForRefinement(h.book.entries[7].content);
 assert.equal(parsed.latest.startFloor,121);assert.equal(parsed.latest.endFloor,150);
 assert.deepEqual(parsed.history.map(item=>item.text),['old-1-60','old-61-120']);
 assert(h.requests[0].some(item=>item.content.includes('small-121-150')));assert(!h.requests[0].some(item=>item.content.includes('old-1-60')));
 assert.equal(h.book.entries[7].comment,'【敕史局】对话流水总帐');assert.equal(Object.keys(h.book.entries).length,2);
 const p=await harness(true);p.book.entries[7].content=oldLedger({placeholder:true});
 const sent=[];p.ingest=async text=>{sent.push(text);return{success:true,count:1};};await p.merge();
 assert.deepEqual(sent,['old-61-120']);assert.equal(ledger.parseLedgerForRefinement(p.book.entries[7].content).missingHistoryThrough,60);
});

test('selected old book is used for progress and writes; missing or ambiguous books never restart silently',async()=>{
 const h=await harness();h.settings.lorebookTarget='dedicated';
 const key=recovery.chatKey(h.fixture.getContext());h.settings.historiographyWorldbookOverrides={[key]:'old-book-number-8'};h.fixture.world_names.push('old-book-number-8');
 assert.equal(await h.module.getTargetLorebookName(),'old-book-number-8');assert(await h.module.executeManualSummary(91,92,true));
 assert.equal(h.writeTarget.book,'old-book-number-8');
 h.fixture.world_names.splice(h.fixture.world_names.indexOf('old-book-number-8'),1);await assert.rejects(h.module.getTargetLorebookName,/不存在/);
 h.settings.historiographyWorldbookOverrides={};h.book.entries[8]={comment:'[amily3]总结',content:append('',1)};
 await assert.rejects(()=>h.module.readGoldenLedgerProgress('book'),/多个启用/);
 h.book.entries[8]=null;h.book.entries[7].content='broken';await assert.rejects(()=>h.module.readGoldenLedgerProgress('book'),/缺少进度/);
});

test('old book selection validates content, scope and progress and invalidates earlier previews',async()=>{
 const ctx={characterId:0,chatId:'A',chat:Array(200).fill({mes:'a'})},settings={test:{}};
 let book={entries:{7:{comment:'【敕史局】对话流水总帐',content:oldLedger()}}},saved=0;
 const fixture={...names,...ledger,...recovery,getContext:()=>ctx,extension_settings:settings,extensionName:'test',world_names:['旧书-8'],loadWorldInfo:async()=>structuredClone(book),saveSettingsDebounced:()=>{saved++;}};
 globalThis.__bookSelection=fixture;
 let source=await read('personal/legacy-book.js'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 for(const node of [...ast.body].reverse())if(node.type==='ImportDeclaration')source=source.slice(0,node.start)+node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__bookSelection[${JSON.stringify(spec.imported.name)}];`).join('\n')+source.slice(node.end);
 const api=await load(source),before=structuredClone(book),revision=recovery.getRecoveryRevision();
 await api.selectSummaryWorldbook('旧书-8');assert(recovery.getRecoveryRevision()>revision);assert.equal(settings.test.historiographyWorldbookOverrides[recovery.chatKey(ctx)],'旧书-8');assert.deepEqual(book,before);
 ctx.chatId='B';assert.equal(settings.test.historiographyWorldbookOverrides[recovery.chatKey(ctx)],undefined);ctx.chatId='A';
 await api.selectSummaryWorldbook('');assert.equal(saved,2);
 await assert.rejects(()=>api.selectSummaryWorldbook('missing'),/不存在/);
 book.entries[8]={comment:'[amily3]总结',content:oldLedger()};await assert.rejects(()=>api.selectSummaryWorldbook('旧书-8'),/多个/);delete book.entries[8];
 book.entries[7].content='broken';await assert.rejects(()=>api.selectSummaryWorldbook('旧书-8'),/结构/);
 book.entries[7].content=oldLedger().replace('前150楼总结已完成','前250楼总结已完成');await assert.rejects(()=>api.selectSummaryWorldbook('旧书-8'),/超过/);
 book={entries:{8:{content:'【宏史卷分段开始：1-60楼】\ntext',disable:false}}};await assert.rejects(()=>api.selectSummaryWorldbook('旧书-8'),/新版分段/);
});

test('an original old archive restores with retained vector-reference text and future libraries disabled',async()=>{
 const h=await harness();h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 h.book.entries[8]={comment:'【敕史局】对话流水总帐_归档_2025-01-01T10-00-00',disable:true,content:oldLedger({placeholder:true})};
 h.bases=[{id:'old',source:'lorebook',name:'book: 大总结 1-60楼',enabled:true},{id:'future',source:'lorebook',name:'book: 大总结 151-200楼',enabled:true}];
 assert(await h.module.restoreArchivedLedger(8));assert.equal(await h.module.readGoldenLedgerProgress('book'),150);
 assert.equal(h.bases[1].enabled,false);assert.equal(h.chat[149].is_system,true);assert.equal(h.chat[150].is_system,false);
 assert.equal(ledger.parseLedgerForRefinement(h.book.entries[8].content).missingHistoryThrough,60);
});

test('archive restores vector choices and exact hidden flags; a failed restore rolls everything back',async()=>{
 const h=await harness();h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 h.chat[0].is_system=true;h.chat[5].is_system=true;
 h.bases=[{id:'past',owner:'x',name:'book: 大总结 1-60楼',source:'lorebook',enabled:true},{id:'novel',name:'小说: other',source:'novel',enabled:true}];
 assert.equal(await h.module.archiveCurrentLedger(),true);
 assert.equal(h.book.entries[7].amily3Archive.visibility.messages[5].hidden,true);
 h.book.entries[8]={uid:8,comment:'[amily3]总结',content:append('',91)};
 h.bases.push({id:'future',owner:'x',name:'book: 大总结 91-180楼',source:'lorebook',enabled:true});
 h.chat.forEach(m=>m.is_system=true);
 const originalBook=structuredClone(h.book),originalBases=structuredClone(h.bases);
 h.failVisibility=true;assert.equal(await h.module.restoreArchivedLedger(7),false);
 assert.deepEqual(h.book,originalBook);assert.deepEqual(h.bases,originalBases);assert(h.chat.every(m=>m.is_system));
 assert.equal(await h.module.restoreArchivedLedger(7),true);
 assert.equal(h.bases.find(b=>b.id==='future').enabled,false);assert(h.bases.find(b=>b.id==='novel').enabled);
 assert.equal(h.chat[5].is_system,true);assert.equal(h.chat[6].is_system,false);
 assert.equal(h.book.entries[8].disable,true);assert.equal(await h.module.readGoldenLedgerProgress('book'),90);
 const once=structuredClone(h.book);assert.equal(await h.module.restoreArchivedLedger(7),false);assert.deepEqual(h.book,once);
});

test('visibility and legacy range fallbacks reject wrong chats and edits without guessing',()=>{
 const ctx={characterId:0,chatId:'A',chat:[{mes:'a',is_system:true},{mes:'b',is_system:false}]};
 const snapshot=recovery.captureVisibility(ctx);ctx.chat.push({mes:'c',is_system:true});
 assert.deepEqual(recovery.visibilityPlan(ctx,snapshot,2),[true,false,false]);
 assert.deepEqual(recovery.visibilityCommands(ctx.chat,[false,true,false]),['/unhide 0-0','/hide 1-1','/unhide 2-2']);
 assert.deepEqual(recovery.visibilityPlan(ctx,null,1),[true,false,false]);
 assert.throws(()=>recovery.visibilityPlan({...ctx,chatId:'B'},snapshot,2),/另一个聊天/);
 ctx.chat[0].mes='edited';assert.throws(()=>recovery.visibilityPlan(ctx,snapshot,2),/修改/);
 assert.throws(()=>recovery.visibilityPlan(ctx,null,9),/范围/);
 const bases=[{id:'past',source:'lorebook',name:'book: 小总结 1-20楼',enabled:true},
 {id:'cross',source:'lorebook',name:'book: 大总结 20-100楼',enabled:true},
 {id:'unknown',source:'lorebook',name:'book: [amily3]总结',enabled:true},
 {id:'novel',source:'novel',name:'book: 大总结 90-100楼',enabled:true}];
 assert.deepEqual(recovery.knowledgeRestorePlan(bases,'book',null,50).map(p=>[p.base.id,p.enabled]),[['past',true],['cross',false],['unknown',false]]);
 const saved=recovery.captureKnowledgeState(bases,'book');bases[0].memoryRevision=1;
 assert.equal(recovery.knowledgeRestorePlan(bases,'book',saved,50)[0].enabled,false);
});

test('a worldbook write failure restores cached book state and does not report a completed recovery',async()=>{
 const h=await harness();h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 const beforeArchive=structuredClone(h.book);h.failWorldSave=true;
 assert.equal(await h.module.archiveCurrentLedger(),false);assert.deepEqual(h.book,beforeArchive);assert.equal(recovery.isMemoryRecovering(),false);
 assert.equal(await h.module.archiveCurrentLedger(),true);
 h.book.entries[8]={uid:8,comment:'[amily3]总结',content:append('',91)};
 const beforeRestore=structuredClone(h.book);h.failWorldSave=true;
 assert.equal(await h.module.restoreArchivedLedger(7),false);assert.deepEqual(h.book,beforeRestore);assert.equal(recovery.isMemoryRecovering(),false);
});

test('regeneration keeps original input, adds first draft only for supplied instructions, and never writes automatically',async()=>{
 const h=await harness();await h.preview();
 const original=h.book.entries[7].content,firstDraft=h.firstDraft;
 await h.regenerate({requirements:'根据后面的日期重新对齐',firstDraft});
 let request=h.requests.at(-1);assert(request.some(m=>m.role==='assistant'&&m.content===firstDraft));
 assert(request.some(m=>m.content.includes('new-1')));assert(request.at(-1).content.includes('根据后面的日期重新对齐'));
 assert.equal(h.book.entries[7].content,original);
 await h.regenerate({requirements:'  ',firstDraft});request=h.requests.at(-1);
 assert(!request.some(m=>m.role==='assistant'));assert(request.some(m=>m.content.includes('new-1')));
 h.settings.historiographySilent=false;
 const pending=h.module.executeManualSummary(91,92,true);await new Promise(resolve=>setImmediate(resolve));
 await h.regenerate({requirements:'保留关键对话',firstDraft:h.firstDraft});request=h.requests.at(-1);
 assert(request.some(m=>m.content.includes('【第 91 楼】')));assert(request.at(-1).content.includes('保留关键对话'));
 h.cancel();assert.equal(await pending,false);assert.equal(h.book.entries[7].content,original);
});

test('a recovery invalidates a summary preview created before restoration',async()=>{
 const h=await harness();await h.preview();const original=h.book.entries[7].content;
 recovery.beginMemoryRecovery();recovery.endMemoryRecovery();
 await assert.rejects(h.confirm,/归档状态已变化/);assert.equal(h.book.entries[7].content,original);
});

test('new timeline defaults retain detailed requirements and migrate previous defaults without replacing custom requests',async()=>{
 const legacy=await load(await read('personal/prompt-legacy.js'));globalThis.__promptLegacy=legacy;
 const style=await load((await read('personal/prompt-style.js')).replace(/import[^\n]+from '\.\/prompt-legacy.js';/,'const {LEGACY_MEMORY_PROMPTS,LEGACY_SUMMARY_CHAIN}=globalThis.__promptLegacy;'));
 const prompt=style.MEMORY_PROMPTS.historiographySmallSummaryPrompt;
 for(const term of ['关键物品','关键对话','关键动作','关键结果','上下文行','yyyy-MM-dd(Xd)','事件行数','相对天数与具体日期分开','日期锚点','暂定第1天','跨日不明']) assert(prompt.includes(term),term);
 assert(style.MEMORY_PROMPTS.historiographyLargeRefinePrompt.includes('大总结必须重新梳理本次输入的时间线'));
 assert(!prompt.includes('必须推算并保留'));
 const memory=new Map([['amily3_prompt_settings_backup_v1','old-originals']]);
 const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 const settings={...style.PREVIOUS_MEMORY_PROMPTS,historiographySmallJailbreakPrompt:'我自己的规则，保留相对天数'};
 assert(style.migrateMemoryPrompts(settings,storage));assert.equal(settings.historiographySmallJailbreakPrompt,'我自己的规则，保留相对天数');
 assert.equal(settings.historiographySmallSummaryPrompt,prompt);assert.equal(memory.get('amily3_prompt_settings_backup_v1'),'old-originals');
 assert(memory.get('amily3_prompt_settings_backup_v2'));assert.equal(style.migrateMemoryPrompts(settings,storage),false);
});

test('real auto-hide module restores both directions and resolves new summary book names',async()=>{
 const ctx={characterId:1,chatId:'A',chat:[{mes:'a',is_system:true},{mes:'b',is_system:true},{mes:'c',is_system:false}]};
 const commands=[];let readBook,interrupt=false;
 const fixture={...recovery,...names,notify:{},getContext:()=>ctx,extensionName:'test',extension_settings:{test:{autoHideSummarizedEnabled:true,lorebookTarget:'dedicated'}},getTargetLorebookName:async()=> '[amily3]总结-char-test',
 readGoldenLedgerProgress:async book=>{readBook=book;if(interrupt){recovery.beginMemoryRecovery();recovery.endMemoryRecovery();}return 1;},SlashCommandParser:class{parse(command){return{execute:async()=>{commands.push(command);const [,kind,start,end]=command.match(/^\/(hide|unhide) (\d+)-(\d+)$/);for(let i=+start;i<=+end;i++)ctx.chat[i].is_system=kind==='hide';}};}}};
 globalThis.__visibilityFixture=fixture;
 let source=await read('core/autoHideManager.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 for(const node of [...tree.body].reverse())if(node.type==='ImportDeclaration')source=source.slice(0,node.start)+node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__visibilityFixture[${JSON.stringify(spec.imported.name)}];`).join('\n')+source.slice(node.end);
 const module=await load(source);
 await module.restoreMemoryVisibility(null,1);assert.deepEqual(ctx.chat.map(m=>m.is_system),[true,false,false]);
 await module.executeAutoHide();assert.equal(readBook,'[amily3]总结-char-test');assert(commands.includes('/unhide 1-1'));
 const count=commands.length;interrupt=true;await module.executeAutoHide();assert.equal(commands.length,count,'stale auto-hide cannot overwrite restored visibility');
});

test('restored knowledge state prevents legacy fallback and invalidates revised collections',async()=>{
 const source=await read('core/rag-processor.js'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const namesToExtract=['captureMemoryKnowledgeState','restoreMemoryKnowledgeState','memoryEpoch','queryVectors'];
 const funcs=ast.body.map(n=>n.declaration||n).filter(n=>n.type==='FunctionDeclaration'&&namesToExtract.includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
 const bases={future:{id:'future',owner:'owner',source:'lorebook',name:'book: 大总结 91-180楼',enabled:true}},settings={retrieval:{independentChatMemoryEnabled:false}};
 let legacyCalls=0,queried=[];
 const fixture={...recovery,settings,getKnowledgeBases:()=>bases,getLocalKnowledgeBases:()=>bases,getGlobalKnowledgeBases:()=>({}),getCharacterStableId:()=> 'owner',getChatId:()=> 'chat',saveSettings:()=>{},getDynamicCollectionId:async()=>{legacyCalls++;return 'legacy';},getEmbeddings:async()=>[[1]],_executeQueryForBase:async base=>{queried.push(base);return[]}};
 const keys=Object.keys(fixture);const api=new Function(...keys,funcs+';return {captureMemoryKnowledgeState,restoreMemoryKnowledgeState,memoryEpoch,queryVectors};')(...keys.map(key=>fixture[key]));
 const previousEpoch=api.memoryEpoch('book');const state=api.restoreMemoryKnowledgeState('book',null,90);
 assert.notEqual(api.memoryEpoch('book'),previousEpoch);assert.equal(bases.future.enabled,false);
 await api.queryVectors('test');assert.equal(legacyCalls,0);assert.equal(queried.length,0);
 settings.retrieval.independentChatMemoryEnabled=true;await api.queryVectors('test');assert.equal(queried.length,0);
 state.undo();assert.equal(bases.future.enabled,true);
});

test('summary branding preserves old books, progress and archive compatibility',async()=>{
 assert.equal(names.summaryBookName('char-17',[]),'[Memory]总结-char-17');
 assert.equal(names.summaryBookName('char-17',['Amily2-Lore-char-17']),'Amily2-Lore-char-17');
 assert.equal(names.summaryBookName('char-17',['[amily3]总结-char-17','Amily2-Lore-char-17']),'[amily3]总结-char-17');
 const h=await harness();Object.assign(h.settings,{lorebookTarget:'dedicated'});h.fixture.world_names.push('Amily2-Lore-char-preview');
 assert.equal(await h.module.getTargetLorebookName(),'Amily2-Lore-char-preview');
 assert.equal(await h.module.readGoldenLedgerProgress('book'),90);
 assert.equal(await h.module.executeManualSummary(91,91,true),true);
 assert.equal(h.writeTarget.name,'【敕史局】对话流水总帐');
 h.book.entries[7].comment='[amily3]总结';
 const original=h.book.entries[7].content;
 assert.equal(await h.module.archiveCurrentLedger(),true);
 assert.equal(h.book.entries[7].disable,true);
 assert.equal((await h.module.getArchivedLedgers()).length,1);
 h.book.entries[8]={uid:8,comment:'【敕史局】对话流水总帐_归档_2025-01',content:original,disable:true};
 assert.equal((await h.module.getArchivedLedgers()).length,2);
 assert.equal(await h.module.restoreArchivedLedger(8),true);
 assert.equal(h.book.entries[8].comment,'[Memory]总结');
 assert.equal(await h.module.readGoldenLedgerProgress('book'),91);
 assert.equal(h.book.entries[8].content,original);
});

test('Memory settings migration copies old settings once without mutating the source',async()=>{
 const {migrateExtensionSettings}=await load(await read('personal/migration.js'));
 const settings={Memory1:{amily2_profiles:[{id:'saved'}],historiographyWorldbookOverrides:{chat:'saved-book'}}};
 assert.equal(migrateExtensionSettings(settings,'Memory'),true);
 assert.deepEqual(settings.Memory,settings.Memory1);
 settings.Memory.amily2_profiles[0].id='new';assert.equal(settings.Memory1.amily2_profiles[0].id,'saved');
 assert.equal(migrateExtensionSettings(settings,'Memory'),false);
 assert.equal(names.isSummaryEntry({comment:'[Memory]总结'}),true);
 assert.equal(names.isSummaryEntry({comment:'[amily3]总结'}),true);
 assert.equal(names.isArchivedSummary({comment:'[amily3]总结_归档_2026'}),true);
 assert.equal(names.summaryBookName('chat',['[amily3]总结-chat']),'[amily3]总结-chat');
});

test('plugin notifications use its name without changing host notifications or options',async()=>{
 globalThis.__names=names;
 const {notify}=await load((await read('personal/notify.js')).replace("import { APP_NAME } from './names.js';",'const {APP_NAME}=globalThis.__names;'));
 const received=[];const host={warning(...args){received.push(args);return 42;},clear(){return 'cleared';}};globalThis.toastr=host;
 const options={timeOut:100};assert.equal(notify.warning('保留原文','旧标题',options),42);
 assert.deepEqual(received[0],['保留原文','Memory',options]);assert.equal(globalThis.toastr,host);
 host.warning('宿主消息','宿主名称');assert.equal(received[1][1],'宿主名称');assert.equal(notify.clear(),'cleared');
 notify.warning('Memory正在总结；Amily2 初始化完成；amily2 消息；[Memory-外交部] 已连接。','Memory',options);
 assert.deepEqual(received[2],['Memory正在总结；Memory 初始化完成；Memory 消息；[Memory-外交部] 已连接。','Memory',options]);
 notify.warning('原书 Amily2-Lore-old-chat；路径 Memory/core；组件 Amily2Bus；键 amily2_profiles');
 assert.equal(received[3][0],'原书 Amily2-Lore-old-chat；路径 Memory/core；组件 Amily2Bus；键 amily2_profiles');
 const node={nodeType:1,textContent:'Amily2'};notify.warning(node);assert.equal(received[4][0],node);
 notify.warning('MemoryAPI连接成功');assert.equal(received[5][0],'MemoryAPI连接成功');
});

test('legacy ledger refinement keeps ten independent ranges in the same native row',async()=>{
 const h=await harness();
 for(let i=0;i<10;i++){
  if(i)h.book.entries[7].content=append(h.book.entries[7].content,i*90+1);
  await h.merge();const parsed=ledger.parseLedgerForRefinement(h.book.entries[7].content);
  assert.equal(parsed.latest.startFloor,i*90+1);assert.equal(parsed.latest.endFloor,(i+1)*90);assert.equal(parsed.history.length,i);
  assert.doesNotMatch(JSON.stringify(h.requests.at(-1)),/macro-/);assert.match(JSON.stringify(h.requests.at(-1)),new RegExp(`new-${i*90+1}`));
  assert.equal(Object.keys(h.book.entries).length,2);assert.equal(h.book.entries[9].content,'unrelated');
 }
 assert.equal(h.backups.length,10);
});

test('automatic large summaries use saved pending blocks, preserve later blocks and do not repeat',async()=>{
 const h=await harness();h.settings.historiographyLargeAutoEvery=2;
 assert.equal(await h.module.maybeTriggerAutomaticRefinement('book'),true);
 let parsed=ledger.parseLedgerForRefinement(h.book.entries[7].content);
 assert.equal(parsed.latest.endFloor,60);assert.equal(parsed.pendingBlockCount,1);assert.equal(parsed.totalFloors,90);
 assert.equal(await h.module.maybeTriggerAutomaticRefinement('book'),false);assert.equal(h.requests.length,1);
 h.book.entries[7].content=ledger.appendMicroSummaryBlock(h.book.entries[7].content,'new-91',91,120,128000).content;
 assert.equal(await h.module.maybeTriggerAutomaticRefinement('book'),true);
 parsed=ledger.parseLedgerForRefinement(h.book.entries[7].content);
 assert.equal(parsed.latest.startFloor,61);assert.equal(parsed.latest.endFloor,120);assert.equal(parsed.pendingBlockCount,0);
 assert(!h.requests[1].some(m=>m.content.includes('macro-1')));
 const reloaded=await harness();reloaded.book=structuredClone(h.book);reloaded.settings.historiographyLargeAutoEvery=2;
 assert.equal(await reloaded.module.maybeTriggerAutomaticRefinement('book'),false);
});

test('automatic large preview is deduplicated and cancellation does not clear saved small summaries',async()=>{
 const h=await harness();h.settings.historiographyLargeAutoEvery=3;h.settings.historiographySilent=false;
 const original=h.book.entries[7].content;
 const pending=h.module.maybeTriggerAutomaticRefinement('book');await new Promise(resolve=>setImmediate(resolve));
 assert(h.confirm);assert.equal(await h.module.maybeTriggerAutomaticRefinement('book'),false);assert.equal(h.requests.length,1);
 h.cancel();assert.equal(await pending,false);assert.equal(h.book.entries[7].content,original);
 h.failGeneration=true;assert.equal(await h.module.maybeTriggerAutomaticRefinement('book'),false);assert.equal(h.book.entries[7].content,original);
});

test('successful small writes trigger automatic large summary; duplicate, failed or cancelled work does not count',async()=>{
 const h=await harness();h.book.entries[7].content='';
 Object.assign(h.settings,{lorebookTarget:'character_main',historiographyLargeAutoEvery:2});
 h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 assert.equal(await h.module.executeManualSummary(1,1,true),true);
 assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).pendingBlockCount,1);
 assert.equal(await h.module.executeManualSummary(1,1,true),false);
 assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).pendingBlockCount,1);
 assert.equal(await h.module.executeManualSummary(2,2,true),true);
 assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).pendingBlockCount,0);
 const original=h.book.entries[7].content;
 h.failWrite=true;assert.equal(await h.module.executeManualSummary(3,3,true),false);assert.equal(h.book.entries[7].content,original);
 h.failGeneration=true;
 assert.equal(await Promise.race([h.module.executeManualSummary(3,3,true),new Promise((_,reject)=>setTimeout(()=>reject(Error('summary stalled')),500))]),false);
});
test('previous macro leaves worldbook only after successful vector ingestion',async()=>{
 const h=await harness(true);await h.merge();h.book.entries[7].content=append(h.book.entries[7].content,91);
 const sent=[];h.ingest=async text=>{sent.push(text);return{success:true,count:1}};await h.merge();
 assert.deepEqual(sent,['macro-1']);const parsed=ledger.parseLedgerForRefinement(h.book.entries[7].content);assert.equal(parsed.history.length,0);assert.equal(parsed.latest.text,'macro-2');
});
test('failed or empty ingestion retains history and supports a later manual retry',async()=>{
 const h=await harness(true);await h.merge();h.book.entries[7].content=append(h.book.entries[7].content,91);
 h.ingest=async()=>({success:false,error:'offline'});await h.merge();assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).history.length,1);
 h.ingest=async()=>({success:true,count:0});await h.module.vectorizeRetainedLedgerHistory('book',7);assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).history.length,1);
 h.ingest=async()=>({success:true,count:1});await h.module.vectorizeRetainedLedgerHistory('book',7);assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).history.length,0);
});
test('preview race and unavailable local backup preserve original worldbook',async()=>{
 const h=await harness();await h.preview();h.book.entries[7].content+=' edited';const source=h.book.entries[7].content;await assert.rejects(h.confirm,/发生变化/);assert.equal(h.book.entries[7].content,source);
 const j=await harness();j.failBackup=true;const before=j.book.entries[7].content;await assert.rejects(j.merge,/quota/);assert.equal(j.book.entries[7].content,before);
});
test('manual late-range summary starts at actual first pending floor',async()=>{
 const h=await harness();h.book.entries[7].content=append('',151);await h.merge();assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).latest.startFloor,151);
});
test('chat switch during preview cannot write or vectorize into a different chat',async()=>{
 const h=await harness(true);await h.preview();const before=h.book.entries[7].content;h.chatId='different';await assert.rejects(h.confirm,/聊天.*变化|聊天已切换/);assert.equal(h.book.entries[7].content,before);assert.equal(h.backups.length,0);
});
test('one malformed row does not hide all healthy worldbook entries',async()=>{
 const h=await harness();h.book.entries[10]=null;const rows=await h.module.getLoresForWorldbook('book');assert.equal(rows.length,2);assert.ok(rows.some(row=>row.key==='7'));
});
test('removed functionality cannot be re-enabled by old configuration',()=>{
 const s={optimizationEnabled:true,model:'original',historiographySmallTriggerThreshold:30};features.applyPersonalFeaturePolicy(s);for(const key of features.DISABLED_FLAGS){s[key]=true;assert.equal(s[key],false)}assert.equal(s.model,'original');assert.equal(s.historiographySmallTriggerThreshold,30);
});
test('production import graph contains original memory panels without removed runtimes',async()=>{
 const seen=new Set();async function visit(file){if(seen.has(file))return;seen.add(file);const source=await fs.readFile(file,'utf8'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});for(const n of tree.body)if(n.source?.value.startsWith('.'))await visit(path.resolve(path.dirname(file),n.source.value));}
 await visit(path.join(root,'personal/main.js'));
 for(const file of seen)assert.doesNotMatch(path.relative(root,file).replaceAll('\\','/'),/^(index.js|imports.js|core\/(?:table-system|super-memory|sfigen|combat|auto-char-card|relationship-graph)\/|core\/(?:commands|archive-manager).js)/);
 for(const name of ['ui/historiography-bindings.js','ui/hanlinyuan-bindings.js','ui/api-config-bindings.js'])assert.ok(seen.has(path.join(root,name)));
});
test('real vector writer requires readback of all hashes, rejects invalid embeddings and retries stably',async()=>{
 const source=await read('core/rag-processor.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const funcs=tree.body.filter(n=>n.type==='FunctionDeclaration'&&['insertVectors','generateHash'].includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
 const {writeUniqueVectorChunks}=await load(await read('personal/vector-writes.js'));
 let saved=[],missing=false,fail=false,inserted=[];
 // Real ST inserts append new storage IDs, even if metadata hashes repeat.
 const fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/insert')){if(!fail){inserted.push(body.items);saved.push(...body.items);}return{ok:!fail,status:500}}return{ok:true,json:async()=>url.endsWith('/list')?saved.map(i=>Number(i.hash)):{metadata:missing?saved.slice(0,-1):saved}}};
 const insert=new Function('fetch','context','writeUniqueVectorChunks',funcs+';return insertVectors;')(fetch,{getRequestHeaders:()=>({})},writeUniqueVectorChunks);
 const items=[{text:'old macro',vector:[0.1,0.3]},{text:'second chunk',vector:[0.2,0.4]}];await insert(items,null,'book');await insert(items,null,'book');assert.equal(inserted.length,1);assert.equal(saved.length,2);
 assert(inserted[0].every(i=>Number.isSafeInteger(i.hash)));
 missing=true;await assert.rejects(insert(items,null,'book'),/回读全部/);missing=false;fail=true;await assert.rejects(insert([{text:'new',vector:[0.1,0.2]}],null,'book'),/API错误/);await assert.rejects(insert([{text:'x',vector:[]}],null,'book'),/无效数据/);
});

test('append-only backend retries after failed readback and concurrent writes do not duplicate stored text',async()=>{
 const {writeUniqueVectorChunks}=await load(await read('personal/vector-writes.js'));
 let rows=[],insertCalls=0,failRead=true;
 const fetcher=async(url,init)=>{const body=JSON.parse(init.body);
  if(url.endsWith('/insert')){insertCalls++;rows.push(...body.items);return{ok:true};}
  if(url.endsWith('/query')&&failRead){failRead=false;return{ok:false,status:503};}
  return{ok:true,json:async()=>url.endsWith('/list')?rows.map(row=>row.hash):{metadata:rows}};
 };
 const options={collectionId:'retry',headers:{},generateHash:()=>1,vectorItems:[{text:'same',vector:[0.2,0.4]}],fetcher};
 await assert.rejects(writeUniqueVectorChunks(options),/回读失败/);assert.equal(rows.length,1);
 const retried=await writeUniqueVectorChunks(options);assert.equal(retried.inserted,0);assert.equal(rows.length,1);assert.equal(insertCalls,1);
 rows=[];insertCalls=0;
 await Promise.all([writeUniqueVectorChunks(options),writeUniqueVectorChunks(options)]);assert.equal(rows.length,1);assert.equal(insertCalls,1);
 await writeUniqueVectorChunks({...options,vectorItems:[{text:'different text, same hash',vector:[0.2,0.4]}]});assert.equal(rows.length,2);
 rows=[{hash:'old-base36-hash',text:'same'}];insertCalls=0;
 await writeUniqueVectorChunks(options);assert.equal(rows.length,1);assert.equal(insertCalls,0);
});

test('duplicate audit counts exact copies without treating overlap as duplication',async()=>{
 const {auditChunkDuplicates}=await load(await read('personal/chunk-audit.js'));
 const result=auditChunkDuplicates([{text:'same'},{text:'same'},{text:'prefix same'},{text:'same suffix'}]);
 assert.equal(result.unique,3);assert.equal(result.extra,1);assert.deepEqual(result.groups,[[1,2]]);
});

test('raw chat ingestion cannot run or auto-register in this edition',async()=>{
 const source=await read('core/rag-processor.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const funcs=tree.body.filter(n=>n.type==='FunctionDeclaration'&&['getMessagesForCondensation','processCondensation'].includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
 const api=new Function(funcs+';return {getMessagesForCondensation,processCondensation};')();
 assert.deepEqual(api.getMessagesForCondensation(),[]);
 assert.equal((await api.processCondensation([{mes:'raw chat'}])).success,false);
 assert(!source.includes('eventSource.on(event_types.MESSAGE_RECEIVED, handleAutoCondensation)'));
 const bindings=await read('ui/hanlinyuan-bindings.js');
 assert(!bindings.includes('window.startHLYCondensation ='));
 assert(!bindings.includes('window.previewHLYCondensation ='));
});

test('chunk viewer reads actual stored text, requests all blocks and reports partial reads',async()=>{
 const {readVectorChunks}=await load(await read('personal/vector-reader.js'));
 const requests=[];let partial=false,empty=false,embeddingCalls=0;
 const rows=[{hash:2,index:1,text:'原分块二 <img src=x>'},{hash:1,index:0,text:'原分块一'}];
 const options={collectionId:'owner_book',headers:{},embed:async()=>{embeddingCalls++;return[[0.1,0.2]]},fetcher:async(url,init)=>{
  requests.push([url,JSON.parse(init.body)]);
  return {ok:true,json:async()=>url.endsWith('/list')?(empty?[]:[1,2]):{metadata:partial?rows.slice(0,1):rows}};
 }};
 const result=await readVectorChunks(options);assert.equal(result.total,2);assert.equal(result.complete,true);
 assert.deepEqual(result.chunks.map(c=>c.text),[rows[1].text,rows[0].text]);
 assert.equal(requests[1][1].topK,2);assert.equal(requests[1][1].threshold,-1);
 assert(requests.every(([url])=>url.endsWith('/list')||url.endsWith('/query')));
 partial=true;assert.equal((await readVectorChunks(options)).complete,false);
 empty=true;await readVectorChunks(options);assert.equal(embeddingCalls,2);
 await assert.rejects(readVectorChunks({...options,fetcher:async()=>({ok:false,status:503})}),/503/);
 await assert.rejects(readVectorChunks({...options,fetcher:async()=>({ok:true,json:async()=>Array(10001).fill(1)})}),/一万/);
});

test('chunk reads cannot cross chat context or resolve a global library to the current character',async()=>{
 const source=await read('core/rag-processor.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const node=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='getKnowledgeBaseChunks');
 let chat='A',seenCollection,switchChat=false;
 const local={local:{name:'local'}},global={shared:{name:'shared',owner:'original-owner'}};
 const readVectorChunks=async options=>{seenCollection=options.collectionId;if(switchChat)chat='B';return {chunks:[]}};
 const fn=new Function('getCharacterStableId','getChatId','getGlobalKnowledgeBases','getLocalKnowledgeBases','GLOBAL_SCOPE_ID','readVectorChunks','context','getEmbeddings',source.slice(node.start,node.end)+';return getKnowledgeBaseChunks;')(()=> 'current',()=>chat,()=>global,()=>local,'_global',readVectorChunks,{getRequestHeaders:()=>({})},()=>{});
 await fn('shared','global');assert.equal(seenCollection,'original-owner_shared');
 await fn('local','local');assert.equal(seenCollection,'current_local');
 await assert.rejects(fn('missing','local'),/不存在/);
 switchChat=true;await assert.rejects(fn('shared','global'),/聊天.*变化|聊天已切换/);
});

test('plain prompt migration replaces exact old defaults and preserves custom text and originals',async()=>{
 const legacy=await load(await read('personal/prompt-legacy.js'));globalThis.__promptLegacy=legacy;
 const style=await load((await read('personal/prompt-style.js')).replace(/import[^\n]+from '\.\/prompt-legacy.js';/,'const {LEGACY_MEMORY_PROMPTS,LEGACY_SUMMARY_CHAIN}=globalThis.__promptLegacy;'));
 const memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 const settings={...legacy.LEGACY_MEMORY_PROMPTS,historiographySmallSummaryPrompt:'我的自定义格式：微言录要保留对话原话'};
 assert(style.migrateMemoryPrompts(settings,storage));assert.equal(settings.historiographySmallSummaryPrompt,'我的自定义格式：小总结要保留对话原话');
 assert.equal(settings.historiographyLargeJailbreakPrompt,style.MEMORY_PROMPTS.historiographyLargeJailbreakPrompt);
 assert(storage.getItem('amily3_prompt_settings_backup_v2').includes('微言录'));
 assert.equal(style.migrateMemoryPrompts(settings,storage),false);
 const manager={presets:{custom:{prompts:{small_summary:[...legacy.LEGACY_SUMMARY_CHAIN.map(content=>({role:'system',content})),{role:'user',content:'自定义：宏史卷格式保留'}]}}}};
 assert(style.migrateMemoryPresetManager(manager,storage));
 assert.equal(manager.presets.custom.prompts.small_summary.length,legacy.LEGACY_SUMMARY_CHAIN.length+1);
 assert.equal(manager.presets.custom.prompts.small_summary.at(-1).content,'自定义：大总结格式保留');
 assert(manager.presets.custom.prompts.small_summary.every(p=>!/Dream Space|梦国|微言录|宏史卷/.test(p.content)));
 const original={...legacy.LEGACY_MEMORY_PROMPTS};
 assert.throws(()=>style.migrateMemoryPrompts(original,{getItem:()=>null,setItem:()=>{throw Error('quota')}}),/quota/);
 assert.deepEqual(original,legacy.LEGACY_MEMORY_PROMPTS);
});

test('invalid block overlap and zero embedding batch fail instead of looping',async()=>{
 const source=await read('core/rag-processor.js'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const n=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='splitIntoChunks');
 const split=new Function('settings',source.slice(n.start,n.end)+';return splitIntoChunks;')({advanced:{chunkSize:100,overlap:100}});
 assert.throws(()=>split('text','manual'),/重叠字数/);
 const api=await read('core/rag-api.js'),ast=parse(api,{ecmaVersion:'latest',sourceType:'module'});
 const fn=ast.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='getEmbeddings').declaration;
 const embed=new Function('getEmbedRetrievalSettings',api.slice(fn.start,fn.end)+';return getEmbeddings;')(async()=>({batchSize:0}));
 await assert.rejects(embed(['text']),/批处理大小/);
});


test('third small preview closes before automatic large preview, and failed writes remain retryable', async()=>{
 const h=await harness();h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 h.book.entries[7].content='';h.settings.historiographyLargeAutoEvery=3;h.settings.historiographySilent=false;
 for(let floor=1;floor<=3;floor++){
   const pending=h.module.executeManualSummary(floor,floor,true);
   await new Promise(resolve=>setImmediate(resolve));
   const confirm=h.confirm;
   if(floor===3){h.failWrite=true;assert.equal(await confirm(),false);assert.equal(h.requests.length,3);h.failWrite=false;}
   assert.equal(await confirm(),true,'write finishes without waiting for the next preview');
   await new Promise(resolve=>setImmediate(resolve));
   if(floor===3){assert.notEqual(h.confirm,confirm,'large preview follows the saved small preview');await h.confirm();}
   assert.equal(await pending,true);
 }
 assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).pendingBlockCount,0);
});

test('explicit silent actions bypass previews even when interactive mode is enabled',async()=>{
 const h=await harness();h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 h.settings.historiographySilent=false;h.settings.historiographyLargeAutoEvery=4;
 assert.equal(await h.module.executeManualSummary(91,91,false,{silent:true}),true);
 assert.equal(h.confirm,undefined,'silent small and its automatic large summary show no preview');
 const j=await harness();j.settings.historiographySilent=false;
 assert.equal(await j.module.executeRefinement('book',7,{silent:true}),true);assert.equal(j.confirm,undefined);
});

test('manual large preview holds its lock until cancellation',async()=>{
 const h=await harness();await h.preview();
 assert.equal(await h.module.executeRefinement('book',7),false);
 h.cancel();assert.equal(await h.pending,false);
 assert.equal(await h.module.executeRefinement('book',7,{silent:true}),true);
});


test('unified silent mode bypasses manual, automatic and large previews',async()=>{
 const h=await harness();h.book.entries[7].content='';h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 h.settings.historiographySilent=true;h.settings.historiographyLargeAutoEvery=2;
 assert.equal(await h.module.executeManualSummary(1,1),true);
 assert.equal(await h.module.executeManualSummary(2,2,true),true);
 assert.equal(h.confirm,undefined);assert.equal(ledger.parseLedgerForRefinement(h.book.entries[7].content).pendingBlockCount,0);
 const j=await harness();j.settings.historiographySilent=true;assert.equal(await j.module.executeRefinement('book',7),true);assert.equal(j.confirm,undefined);
});

test('non-silent automatic small summary waits for result preview without raw preview',async()=>{
 const h=await harness();h.settings.historiographySilent=false;h.settings.lorebookTarget='character_main';h.fixture.characters[0]={data:{extensions:{world:'book'}}};
 const pending=h.module.executeManualSummary(91,92,true);await new Promise(resolve=>setImmediate(resolve));
 assert(h.confirm);assert.equal(h.writeTarget,undefined);await h.confirm();assert.equal(await pending,true);
});
