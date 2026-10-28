const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{Readable}=require('node:stream');
const temp=path.resolve(__dirname,'.offline-bindings-'+process.pid+'.mjs');
fs.writeFileSync(temp,fs.readFileSync(path.resolve(__dirname,'server.mjs'),'utf8').replace(/server\.listen\(8773[\s\S]*$/,'export default server;'));
const prefix='/scripts/extensions/third-party/Memory/';
(async()=>{
 const server=(await import(pathToFileURL(temp).href)).default,serve=server.listeners('request')[0];
 const localResponse=(url,body)=>new Promise((resolve,reject)=>{
  const headers={};let status=200;const req=Readable.from(body?[body]:[]);req.url=new URL(url).pathname;req.method=body?'POST':'GET';
  const res={setHeader(k,v){headers[k.toLowerCase()]=v},writeHead(code){status=code;return res},end(content){resolve({status,headers,body:Buffer.from(content||'')})},get statusCode(){return status},set statusCode(v){status=v}};
  Promise.resolve(serve(req,res)).catch(reject);
 });
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{for(const width of [320,375,1280]){
  const p=await browser.newPage({viewport:{width,height:844}});p.setDefaultTimeout(10000);
  const errors=[],collections=new Map([['林渡_demo-chunks',[{hash:1,index:0,text:'<世界书>\nA 的旧记忆\n</世界书>'}]],['林渡_b-memory',[{hash:11,index:0,text:'<世界书>\nB 的剧情记忆\n</世界书>'}]]]);
  let failInsert=false;
  p.on('pageerror',error=>errors.push(error.message));
  await p.route('http://127.0.0.1:8773/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/scripts/extensions.js')return route.fulfill({contentType:'text/javascript',body:"export * from '/script.js';"});
   if(url.pathname==='/api/chats/search')return route.fulfill({json:['preview','B','C','D'].map(file_name=>({file_name}))});
   if(url.pathname.startsWith('/api/vector/')){
    const body=req.postDataJSON(),rows=collections.get(body.collectionId)||[];
    if(url.pathname.endsWith('/insert')){
     if(failInsert){failInsert=false;return route.fulfill({status:500,body:'simulated write failure'});}
     collections.set(body.collectionId,[...rows,...body.items]);return route.fulfill({json:{}});
    }
    if(url.pathname.endsWith('/list'))return route.fulfill({json:rows.map(row=>row.hash)});
    if(url.pathname.endsWith('/query'))return route.fulfill({json:{metadata:rows}});
    throw Error('editing must not delete vector originals');
   }
   await route.fulfill(await localResponse(req.url(),req.postDataBuffer()));
  });
  await p.route('https://embedding.example.invalid/**',route=>{
   const body=route.request().postDataJSON(),inputs=Array.isArray(body.input)?body.input:[body.input];
   return route.fulfill({json:{data:inputs.map((_,index)=>({index,embedding:[.1,.3]}))}});
  });
  await p.addInitScript(()=>localStorage.setItem('amily2_prompt_version','v3.1_soft_prompt'));
  await p.goto('http://127.0.0.1:8773/');await p.locator('.am-app-header').waitFor({state:'attached'});
  await p.locator('#amily2_drawer_icon').click();
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
  await p.locator('#am-app-sidebar [data-route="kb-retrieval"]').click();
  assert.equal(await p.locator('#hly-independent-chat-memory-enabled').count(),0);
  await p.getByText('未归档时，新聊天接续当前总结和记忆；归档后，新聊天从空白开始。',{exact:true}).waitFor({state:'visible'});
  await p.screenshot({path:path.resolve(__dirname,`../../../qa-tools/simple-memory-settings-${width}.png`)});
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
  await p.locator('#am-app-sidebar [data-route="kb-knowledge-bases"]').click();
  const change=async id=>p.evaluate(async({prefix,id})=>{
   previewContext.chatId=id;previewContext.getCurrentChatId=()=>id;SillyTavern.getContext=()=>previewContext;
   const core=await import(prefix+'core/rag-processor.js');core.getMemoryStoryContext();
   await previewContext.eventSource.emit(previewContext.eventTypes.CHAT_CHANGED);await window.updateHLYMemoryCount();
  },{prefix,id});
  await p.evaluate(async prefix=>{
   const core=await import(prefix+'core/rag-processor.js'),ctx=core.getChatMemoryBindingContext();
   core.saveChatMemoryBindings(ctx.owner,[ctx.chatId],[core.getMemoryBindingReference('demo-chunks','local')]);
   window.archiveA=await core.captureMemoryStoryState();core.archiveMemoryStory(archiveA);
  },prefix);
  await change('B');
  assert.equal(await p.evaluate(async prefix=>(await import(prefix+'core/rag-processor.js')).getChatMemoryBindingContext().references.length,prefix),0);
  await p.evaluate(async prefix=>{
   const core=await import(prefix+'core/rag-processor.js'),ctx=core.getChatMemoryBindingContext();
   core.getLocalKnowledgeBases()['b-memory']={id:'b-memory',name:'B 的剧情',source:'lorebook',enabled:true,owner:'林渡'};
   core.saveChatMemoryBindings(ctx.owner,['B'],[core.getMemoryBindingReference('b-memory','local')]);
   window.bStoryId=core.getMemoryStoryContext().story.id;
  },prefix);
  await change('C');
  assert(await p.evaluate(async prefix=>(await import(prefix+'core/rag-processor.js')).getMemoryStoryContext().story.id===bStoryId,prefix));
  const selector=p.locator('.am-management-chat-select');await p.waitForFunction(()=>[...document.querySelector('.am-management-chat-select').options].some(o=>o.value==='B'));
  await selector.selectOption('B');await p.locator('[data-kb-id="b-memory"] .am-kb-chunks').click();
  let viewer=p.locator('dialog.am-chunk-viewer:not(.am-chat-binding-dialog)');
  await viewer.locator('.am-chunk-card').waitFor();await viewer.locator('.am-chunk-card summary').click();
  await viewer.getByRole('button',{name:'编辑分块',exact:true}).click();
  await viewer.getByRole('textbox',{name:'编辑块 1',exact:true}).fill('<世界书>\n编辑后的 B/C 剧情记忆\n</世界书>');
  failInsert=true;await viewer.getByRole('button',{name:'保存分块',exact:true}).click();
  await viewer.locator('.am-chunk-status').filter({hasText:'API错误'}).waitFor();
  assert.equal(collections.get('林渡_b-memory')[0].text,'<世界书>\nB 的剧情记忆\n</世界书>');
  await viewer.getByRole('button',{name:'保存分块',exact:true}).click();
  await viewer.locator('.am-chunk-card').filter({hasText:'编辑后的 B/C 剧情记忆'}).waitFor();
  const refs=await p.evaluate(async prefix=>{
   const core=await import(prefix+'core/rag-processor.js');
   return{b:core.getChatMemoryBindingContext('B').references,c:core.getChatMemoryBindingContext('C').references,a:archiveA.references};
  },prefix);
  assert.deepEqual(refs.b,refs.c);assert(refs.b[0].collectionId!=='林渡_b-memory');assert.equal(refs.a[0].collectionId,'林渡_demo-chunks');
  assert.equal(collections.get('林渡_b-memory')[0].text,'<世界书>\nB 的剧情记忆\n</世界书>');
  await p.screenshot({path:path.resolve(__dirname,`../../../qa-tools/story-memory-editor-${width}.png`)});
  await viewer.locator('.am-chunk-close').click();
  await p.evaluate(async prefix=>{
   const core=await import(prefix+'core/rag-processor.js');window.archiveC=await core.captureMemoryStoryState();core.archiveMemoryStory(archiveC);
  },prefix);
  await change('D');assert.equal(await p.evaluate(async prefix=>(await import(prefix+'core/rag-processor.js')).getChatMemoryBindingContext().references.length,prefix),0);
  await p.evaluate(async prefix=>{const core=await import(prefix+'core/rag-processor.js');core.restoreMemoryStory(archiveC);},prefix);
  const restored=await p.evaluate(async prefix=>(await import(prefix+'core/rag-processor.js')).getChatMemoryBindingContext().references,prefix);
  assert.equal(restored[0].collectionId,refs.c[0].collectionId);assert(Array.isArray(restored[0].hashes));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,archiveAIsolated:true,bFresh:true,cContinuesB:true,perFileEditor:true,failedEditRetry:true,originalVectorsPreserved:true,dFreshAfterArchive:true,exactRestore:true,errors}));
  await p.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.unlinkSync(temp));
