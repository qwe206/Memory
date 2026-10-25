const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{Readable}=require('node:stream'),{parse}=require('acorn');
const source=fs.readFileSync(path.resolve(__dirname,'../../../qa-tools/st-native-script.js'),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=ast.body.map(n=>n.declaration||n).find(n=>n.type==='FunctionDeclaration'&&n.id.name==='showMoreMessages');
assert(declaration,'official ST showMoreMessages fixture exists');
const loader=source.slice(declaration.start,declaration.end);
const temp=path.resolve(__dirname,'.offline-floor-jump-'+process.pid+'.mjs');
fs.writeFileSync(temp,fs.readFileSync(path.resolve(__dirname,'server.mjs'),'utf8').replace(/server\.listen\(8773[\s\S]*$/,'export default server;'));
(async()=>{
 const server=(await import(pathToFileURL(temp).href)).default,serve=server.listeners('request')[0];
 const localResponse=(url,body)=>new Promise((resolve,reject)=>{const headers={};let status=200;const req=Readable.from(body?[body]:[]);req.url=new URL(url).pathname;req.method=body?'POST':'GET';const res={setHeader(k,v){headers[k.toLowerCase()]=v},writeHead(code){status=code;return res},end(content){resolve({status,headers,body:Buffer.from(content||'')})},get statusCode(){return status},set statusCode(v){status=v}};Promise.resolve(serve(req,res)).catch(reject);});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{for(const width of [320,375,1280]){
  const p=await browser.newPage({viewport:{width,height:844}});p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('http://127.0.0.1:8773/**',async route=>{
   const req=route.request(),r=await localResponse(req.url(),req.postDataBuffer());
   if(new URL(req.url()).pathname==='/scripts/extensions.js')return route.fulfill({contentType:'text/javascript',body:"export * from '/script.js';"});
   if(new URL(req.url()).pathname==='/script.js'){
    const nativeFactory=`${loader};return showMoreMessages;`;
    const extra=`
      const jumpUpdate=(message,{messageId})=>{const node=document.createElement('div');node.className='mes';node.setAttribute('mesid',messageId);node.style.cssText='height:60px;flex-shrink:0';node.textContent=message.mes;if(message.is_system)node.style.display='none';return node;};
      export const showMoreMessages=new Function('chatElement','chat','power_user','getLastMessageId','isElementInViewport','clamp','updateMessageElement','refreshSwipeButtons','applyStylePins','eventSource','event_types',${JSON.stringify(nativeFactory)})($('#chat'),chat,{chat_truncation:50},()=>chat.length-1,()=>false,(n,min,max)=>Math.min(max,Math.max(min,n)),jumpUpdate,()=>{},()=>{},eventSource,event_types);
      export function addOneMessage(message,options){const node=jumpUpdate(message,{messageId:options.forceId});const before=document.querySelector('#chat .mes[mesid="'+options.insertBefore+'"]');if(before)before.before(node);else document.querySelector('#chat').append(node);return $(node);}
    `;
    const host=r.body.toString('utf8').replace(/export const (?:addOneMessage|showMoreMessages)=\(\.\.\.args\)=>\{\};/g,'');
    return route.fulfill({...r,body:host+extra});
   }
   if(new URL(req.url()).pathname==='/')r.body=Buffer.from(r.body.toString('utf8').replace('<body>','<body><div id="chat"></div>'));
   await route.fulfill(r);
  });
  await p.addInitScript(()=>localStorage.setItem('amily2_prompt_version','v3.1_soft_prompt'));
  await p.goto('http://127.0.0.1:8773/');await p.locator('.am-app-header').waitFor({state:'attached'});
  await p.locator('#amily2_drawer_icon').click();
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
  await p.locator('#am-app-sidebar [data-route="floors"]').click();
  await p.evaluate(async()=>{
   const host=await import('/script.js');host.chat.splice(0,host.chat.length,...Array.from({length:5050},(_,i)=>({mes:'楼层 '+i,is_user:i%2===0,is_system:i<20})));
   const box=document.querySelector('#chat');box.style.cssText='position:fixed;top:80px;left:0;width:100%;height:calc(100dvh - 120px);overflow-y:auto;display:flex;flex-direction:column;scroll-behavior:smooth';box.innerHTML='<div id="show_more_messages">更多</div>';
   for(let id=5000;id<5050;id++)host.addOneMessage(host.chat[id],{forceId:id,scroll:false});
   window.beforeJump=JSON.stringify(host.chat);
  });
  const input=p.locator('#amily2_jump_to_message_id'),button=p.locator('#amily2_jump_to_message_btn');
  await p.addStyleTag({content:'#chat .mes[mesid="0"]{display:none!important}'});
  const visibleFloor=async id=>{
   await p.waitForFunction(id=>{
    const node=document.querySelector('#chat .mes[mesid="'+id+'"]');if(!node?.classList.contains('am-floor-jump-target'))return false;
    const container=document.querySelector('#chat'),r=node.getBoundingClientRect(),box=container.getBoundingClientRect();
    if(r.height<=0||r.bottom<=box.top||r.top>=box.bottom)return false;
    const x=r.left+r.width/2,y=(Math.max(r.top,box.top)+Math.min(r.bottom,box.bottom))/2;
    return node.contains(document.elementFromPoint(x,y));
   },id);
   assert(!(await p.locator('#amily2_drawer_content').isVisible()),'menu closes to expose the target');
   return p.locator('#chat').evaluate(el=>el.scrollTop);
  };
  const reopen=async()=>{if(!(await p.locator('#amily2_drawer_content').isVisible()))await p.locator('#amily2_drawer_icon').click();};
  await input.fill('0');await button.click();await visibleFloor(0).catch(async error=>{
   console.error(await p.evaluate(()=>({status:document.querySelector('.am-floor-jump-status')?.textContent,count:document.querySelectorAll('#chat .mes').length,errors:document.querySelector('#preview-errors')?.textContent})));throw error;
  });
  assert.equal(await p.locator('#chat .mes[mesid="0"]').count(),1);
  assert(await p.locator('#chat .mes[mesid="0"]').isVisible());
  assert.equal(await p.evaluate(async()=>JSON.stringify((await import('/script.js')).chat)===window.beforeJump),true);
  assert.equal(await p.locator('#chat .mes').count(),5050);
  const zeroTop=await p.locator('#chat').evaluate(el=>el.scrollTop);assert.equal(zeroTop,0);
  await reopen();await input.fill('5049');await input.press('Enter');const latestTop=await visibleFloor(5049);assert(latestTop>zeroTop);
  await reopen();await input.fill('3000');await button.click();const middleTop=await visibleFloor(3000);assert(middleTop>zeroTop&&middleTop<latestTop);
  await p.screenshot({path:path.resolve(__dirname,`../../../qa-tools/floor-jump-visible-${width}.png`)});
  await reopen();await input.fill('5050');await button.click();await p.getByRole('status').filter({hasText:'未找到楼层 5050'}).waitFor();
  assert(await button.isEnabled());
  const geometry=await p.locator('.am-floor-jump-input').evaluate(el=>{
   const prefix=el.querySelector('.am-floor-jump-prefix'),input=el.querySelector('input');
   return{right:prefix.getBoundingClientRect().right,left:input.getBoundingClientRect().left,prefixColor:getComputedStyle(prefix).color,inputColor:getComputedStyle(input).color};
  });
  assert(geometry.right<geometry.left);assert.equal(geometry.prefixColor,geometry.inputColor);
  assert.equal(await p.locator('dialog[open]').count(),0);
  await p.screenshot({path:path.resolve(__dirname,`../../../qa-tools/floor-jump-${width}.png`)});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,officialLoader:true,floorZeroFrom5050:true,latestFloor:true,middleFloor:true,realScrollPositions:[zeroTop,middleTop,latestTop],targetUnobscured:true,enter:true,savedMessagesUnchanged:true,prefixFits:true,errors}));await p.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.unlinkSync(temp));
