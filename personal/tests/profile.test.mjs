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
