import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), {parse}=require('acorn');
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8');
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(await read(file)).toString('base64'));
const {resolveProfileKey}=await load('personal/profile-key.js');
const {testSelectedProfile}=await load('personal/profile-test.js');
test('blank key fields reuse saved values; typed replacements override; failed reads are explicit',async()=>{
 let reads=0;const manager={getKey:async id=>{reads++;assert.equal(id,'saved');return 'stored-key'}};
 assert.equal(await resolveProfileKey(manager,'saved',''),'stored-key');assert.equal(reads,1);
 assert.equal(await resolveProfileKey(manager,'saved',' new-key '),'new-key');assert.equal(reads,1);
 assert.equal(await resolveProfileKey(manager,null,''),'');
 await assert.rejects(resolveProfileKey({getKey:async()=>{throw Error('private')}},'saved',''),/读取失败/);
});
test('chat test performs generation with selected model and key, never a model-list ping',async()=>{
 let request;const fetcher=async(url,options)=>{request={url,body:JSON.parse(options.body)};return{ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})}};
 await testSelectedProfile({type:'chat',provider:'openai',apiUrl:'https://example.invalid/v1',apiKey:'saved-key',model:'chosen-model'},{fetcher});
 assert.equal(request.url,'/api/backends/chat-completions/generate');assert.equal(request.body.model,'chosen-model');assert.equal(request.body.proxy_password,'saved-key');assert.equal(request.body.stream,false);
});
test('selected unavailable model fails even when relay is online; empty success bodies fail; secrets are redacted',async()=>{
 const p={type:'chat',apiUrl:'https://example.invalid/v1',apiKey:'private-key',model:'missing-model'};
 await assert.rejects(testSelectedProfile(p,{fetcher:async()=>({ok:false,status:404,json:async()=>({error:{message:'missing-model unavailable private-key'}})})}),error=>error.message.includes('missing-model')&&!error.message.includes('private-key'));
 await assert.rejects(testSelectedProfile(p,{fetcher:async()=>({ok:true,json:async()=>({data:[{id:'any-model'}]})})}),/有效结果/);
 await assert.rejects(testSelectedProfile({...p,model:''}),/先选择/);
});
test('embedding and rerank tests request selected model using correct inference endpoint',async()=>{
 for(const type of ['embedding','rerank']){let request;const fetcher=async(url,options)=>{request={url,body:JSON.parse(options.body)};return{ok:true,json:async()=>type==='embedding'?{data:[{embedding:[.1,.2]}]}:{results:[{index:0,relevance_score:.99}]}}};
 await testSelectedProfile({type,model:'selected-'+type,apiUrl:'https://example.invalid/v1',apiKey:'key'},{fetcher});assert.ok(request.url.endsWith(type==='embedding'?'/v1/embeddings':'/v1/rerank'));assert.equal(request.body.model,'selected-'+type);
 }
});
test('Google direct tests use the chosen model, not the /models listing',async()=>{
 let request;await testSelectedProfile({provider:'google',type:'chat',model:'gemini-test',apiUrl:'https://generativelanguage.googleapis.com/v1beta/openai',apiKey:'key'},{fetcher:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({candidates:[{content:{parts:[{text:'OK'}]}}]})}}});
 assert.ok(request.url.endsWith('/models/gemini-test:generateContent'));assert.equal(request.options.headers['x-goog-api-key'],'key');assert.ok(!request.url.includes('key='));
});
class FakeElement extends EventTarget {
 constructor(){super();this.value='';this.dataset={};this.options=[];this.hidden=false;}
 replaceChildren(...options){this.options=options;}
}

test('summary selectors follow the current target and select its active summary rather than the first unrelated row',async()=>{
 const {createSummarySelectors}=await load('personal/summary-selector.js');
 const books=new FakeElement(),entries=new FakeElement();let target='B',release;
 const control=createSummarySelectors({bookSelect:books,entrySelect:entries,listBooks:async()=>['A','B'],targetBook:async()=>target,
  listEntries:async name=>name==='slow'?await new Promise(resolve=>{release=resolve}):[{key:1,comment:'other'},{key:7,comment:'[Memory]总结'}],
  isSummary:row=>row.comment==='[Memory]总结',option:(value,text)=>({value:String(value),text})});
 await control.refresh();assert.equal(books.value,'B');assert.equal(entries.value,'7');
 target='A';await control.refresh();assert.equal(books.value,'A');assert.equal(entries.value,'7');
 books.value='slow';const stale=control.refreshEntries();target='B';await control.refresh();release([{key:99,comment:'[Memory]总结'}]);await stale;
 assert.equal(books.value,'B');assert.equal(entries.value,'7');
 target=null;await control.refresh();assert.equal(books.value,'');assert.equal(entries.value,'');
});

test('assigned rerank metadata is shown with a selected model without exposing keys or modifying fallback settings',async()=>{
 const {syncRerankProfile}=await load('personal/rerank-profile.js');
 const ids=['hly-rerank-api-mode','hly-rerank-url','hly-rerank-model','hly-rerank-api-key'];
 const fields=new Map(ids.map(id=>[id,{value:'',options:[{value:'old-model'}],disabled:false,add(item){this.options.push(item)},ownerDocument:{createElement:()=>({})}}]));
 const fetchButton={disabled:false};fields.get('hly-rerank-model').parentElement={querySelector:()=>fetchButton};
 const note={textContent:''},root={querySelector:selector=>selector==='#am-rerank-profile-status'?note:fields.get(selector.slice(1))};
 const fallback={url:'old-url',model:'old-model',apiKey:'old-key',apiMode:'local_proxy'},before=structuredClone(fallback);
 syncRerankProfile(root,{name:'assigned',apiUrl:'assigned-url',model:'assigned-model',apiKey:'do-not-display'},fallback);
 assert.equal(fields.get('hly-rerank-model').value,'assigned-model');assert(fields.get('hly-rerank-model').options.some(x=>x.value==='assigned-model'));
 assert.equal(fields.get('hly-rerank-api-key').value,'');assert.equal(fields.get('hly-rerank-url').disabled,true);assert.equal(fetchButton.disabled,true);
 assert.match(note.textContent,/assigned-model/);assert.deepEqual(fallback,before);
 syncRerankProfile(root,null,fallback);assert.equal(fields.get('hly-rerank-model').value,'old-model');assert.equal(fields.get('hly-rerank-api-key').value,'old-key');assert.equal(fetchButton.disabled,false);
});

test('assigned rerank profile overrides an explicitly passed stale connection while preserving ranking parameters',async()=>{
 let source=await read('core/rag-api.js'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 let profile={apiUrl:'https://assigned.invalid/v1',apiKey:'assigned-key',model:'assigned-rerank'};
 globalThis.__rerankFixture={getSlotProfile:async slot=>{assert.equal(slot,'ragRerank');return profile}};
 for(const node of [...ast.body].reverse())if(node.type==='ImportDeclaration')source=source.slice(0,node.start)+node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__rerankFixture[${JSON.stringify(spec.imported?.name)}];`).join('\n')+source.slice(node.end);
 const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const oldFetch=globalThis.fetch;let request;
 globalThis.fetch=async(url,options)=>{request={url,options};return{ok:true,json:async()=>({results:[{index:0,relevance_score:.9}]})}};
 const fallback={url:'https://old.invalid/v1',apiKey:'old-key',model:'',apiMode:'custom',top_n:4};
 try {
  await api.executeRerank('query',['text'],fallback);
  assert.equal(request.url,'https://assigned.invalid/v1/rerank');assert.equal(request.options.headers.Authorization,'Bearer assigned-key');
  assert.equal(JSON.parse(request.options.body).model,'assigned-rerank');assert.equal(JSON.parse(request.options.body).top_n,4);
  profile=null;await api.executeRerank('query',['text'],{...fallback,model:'fallback-model'});
  assert.equal(request.url,'https://old.invalid/v1/rerank');assert.equal(JSON.parse(request.options.body).model,'fallback-model');
 } finally {globalThis.fetch=oldFetch;}
});
test('native chooser remains visible and selected when input gains focus; cache restores choices',async()=>{
 const {bindModelPicker,setModelOptions,restoreModelOptions}=await load('personal/model-picker.js');
 globalThis.Option=class{constructor(text,value){this.text=text;this.value=value}};
 const stored=new Map();globalThis.localStorage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
 const input=new FakeElement(),list=new FakeElement(),provider={value:'openai'},url={value:'https://example.invalid'},type={value:'chat'};
 const root={querySelector:selector=>({'#amily2_pf_model':input,'#amily2_pf_model_list':list,'#amily2_pf_provider':provider,'#amily2_pf_url':url,'#amily2_pf_type':type}[selector])};
 bindModelPicker(root);setModelOptions(root,['model-a','model-b'],'',true);list.value='model-b';list.dispatchEvent(new Event('change'));assert.equal(input.value,'model-b');input.dispatchEvent(new Event('focus'));assert.equal(list.value,'model-b');assert.equal(list.hidden,false);
 restoreModelOptions(root,'model-b');assert.deepEqual(list.options.map(o=>o.value),['','model-a','model-b']);input.value='custom-model';input.dispatchEvent(new Event('input'));assert.equal(list.value,'');
});
test('active notification strings contain no old roleplay terms; structural markers stay compatible',async()=>{
 const banned=/远征|圣谕|敕令|遵旨|重铸|召唤|神力|翰林院|国史馆|鸣金收兵|凯旋/;
 for(const file of ['core/historiographer.js','core/autoHideManager.js','core/rag-processor.js','core/rag-api.js','ui/historiography-bindings.js','ui/hanlinyuan-bindings.js']){
  const source=await read(file),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  function walk(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='toastr')for(const arg of node.arguments.slice(0,2)){const staticText=arg.type==='Literal'?arg.value:arg.type==='TemplateLiteral'?arg.quasis.map(q=>q.value.raw).join(''):'';assert.doesNotMatch(String(staticText),banned,file);}
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  }walk(tree);
 }
 assert.match(await read('personal/names.js'),/【敕史局】对话流水总帐/);
});
