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
  const p=await browser.newPage({viewport:{width,height:844}});p.setDefaultTimeout(10000);const errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('http://127.0.0.1:8773/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/chats/search')return route.fulfill({json:[{file_name:'旧剧情聊天'},{file_name:'全新聊天-很长的聊天文件名字-用于验证手机换行'}]});
   if(['/api/vector/insert','/api/vector/delete','/api/vector/purge'].includes(url.pathname))writes.push(url.pathname);
   await route.fulfill(await localResponse(req.url(),req.postDataBuffer()));
  });
  await p.route('https://embedding.example.invalid/**',route=>route.fulfill({json:{data:[{embedding:[.1,.3]}]}}));
  await p.addInitScript(()=>localStorage.setItem('amily2_prompt_version','v3.1_soft_prompt'));
  await p.goto('http://127.0.0.1:8773/');await p.locator('.am-app-header').waitFor({state:'attached'});
  await p.locator('#amily2_drawer_icon').click();
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
  await p.locator('#am-app-sidebar [data-route="kb-knowledge-bases"]').click();
  await p.locator('.am-kb-chunks').first().click();
  const viewer=p.locator('dialog.am-chunk-viewer:not(.am-chat-binding-dialog)');
  await viewer.locator('.am-chunk-search').waitFor();await p.waitForFunction(()=>!document.querySelector('.am-chunk-search').disabled);
  await viewer.getByRole('checkbox',{name:'选择块 1',exact:true}).check();await viewer.locator('.am-chunk-next').click();
  await viewer.getByRole('checkbox',{name:'选择块 13',exact:true}).check();
  assert.equal(await viewer.locator('.am-chunk-selected-count').textContent(),'已选 2 块');
  await viewer.locator('.am-chunk-prev').click();assert(await viewer.getByRole('checkbox',{name:'选择块 1',exact:true}).isChecked());
  await viewer.locator('.am-chunk-bind').click();
  const binding=p.locator('.am-chat-binding-dialog');await binding.getByText('3 个聊天文件 · 已选 1 个').waitFor();
  await binding.getByRole('checkbox',{name:'旧剧情聊天',exact:true}).check();
  assert(await binding.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'binding dialog fits viewport');
  await p.screenshot({path:path.resolve(__dirname,`../../../qa-tools/memory-binding-dialog-${width}.png`)});
  await binding.locator('.am-binding-enable').check();await binding.locator('.am-binding-save').click();await binding.waitFor({state:'detached'});
  let state=await p.evaluate(()=>previewContext.extensionSettings['hanlinyuan-rag-core'].chatMemoryBindings);
  assert.equal(state.enabled,true);assert.equal(Object.keys(state.chats).length,2);
  assert(Object.values(state.chats).every(refs=>JSON.stringify(refs[0].hashes)==='["1000","1012"]'));
  await viewer.locator('.am-chunk-close').click();
  const panel=p.locator('.am-chat-bindings');assert.match(await panel.textContent(),/2 个分块/);
  await panel.getByRole('button',{name:'解除绑定',exact:true}).click();
  state=await p.evaluate(()=>previewContext.extensionSettings['hanlinyuan-rag-core'].chatMemoryBindings);
  assert(Object.values(state.chats).some(refs=>refs.length===0));assert(Object.values(state.chats).some(refs=>refs.length===1));
  // Existing multi-select also supports whole libraries.
  await p.locator('.hly-kb-item-checkbox').first().check();
  await p.locator('#hly-kb-bulk-actions-local [data-action="bind"]').click();
  await binding.locator('.am-binding-save:not(:disabled)').waitFor();await binding.locator('.am-binding-save').click();
  assert.match(await panel.textContent(),/整个知识库/);
  // New chat defaults to no old memories; returning restores its own binding.
  await p.evaluate(async prefix=>{
   previewContext.getCurrentChatId=()=> 'brand-new-chat';globalThis.SillyTavern.getContext=()=>previewContext;
   const ui=await import(prefix+'personal/chat-binding-ui.js');ui.renderChatBindingPanel();
  },prefix);
  assert.match(await panel.textContent(),/不会检索旧知识库/);
  await p.evaluate(async prefix=>{previewContext.getCurrentChatId=()=> 'preview';(await import(prefix+'personal/chat-binding-ui.js')).renderChatBindingPanel();},prefix);
  assert.match(await panel.textContent(),/整个知识库/);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'binding panel fits viewport');
  await p.screenshot({path:path.resolve(__dirname,`../../../qa-tools/memory-bindings-${width}.png`)});
  console.log(JSON.stringify({width,multiBlock:true,multiChat:true,pagesRetainSelection:true,wholeLibrary:true,newChatEmpty:true,noVectorWrites:true,errors}));
  await p.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.unlinkSync(temp));
