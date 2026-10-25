const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('node:path');const {pathToFileURL}=require('node:url');const {Readable}=require('node:stream');
const tempServer=path.resolve(__dirname,'.offline-native-'+process.pid+'.mjs');
fs.writeFileSync(tempServer,fs.readFileSync(path.resolve(__dirname,'server.mjs'),'utf8').replace(/server\.listen\(8773[\s\S]*$/, 'export default server;'));
let serve;
async function localResponse(url,body){let headers={},status=200;return await new Promise((resolve,reject)=>{const req=Readable.from(body?[body]:[]);req.url=new URL(url).pathname+new URL(url).search;req.method=body?'POST':'GET';const res={setHeader(k,v){headers[k.toLowerCase()]=v},writeHead(code){status=code;return res},end(content){resolve({status,headers,body:Buffer.from(content||'')})},get statusCode(){return status},set statusCode(v){status=v}};Promise.resolve(serve(req,res)).catch(reject);});}
const native=JSON.parse(fs.readFileSync(process.env.ST_NATIVE_DRAWER_FIXTURE || path.resolve(__dirname,'../../../qa-tools/st-native-drawer.json'),'utf8'));
(async()=>{
 const server=(await import(pathToFileURL(tempServer).href)).default;serve=server.listeners('request')[0];
 const b=await chromium.launch({headless:true,args:['--no-proxy-server'],executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try {for(const width of [320,375,1280]) {
  const p=await b.newPage({viewport:{width,height:844}});p.setDefaultTimeout(7000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('http://127.0.0.1:8773/**',async route=>{await route.fulfill(await localResponse(route.request().url(),route.request().postDataBuffer()));});
  await p.route('**/script.js',async route=>{
   const r=await localResponse(route.request().url());let s=r.body.toString('utf8');
   const begin=s.indexOf('export async function doNavbarIconClick(){'),end=s.indexOf('export const getSlideToggleOptions',begin);assert(begin>=0&&end>begin);s=s.slice(0,begin)+`const animation_duration=30;const delay=ms=>new Promise(r=>setTimeout(r,ms));const resetScrollHeight=async()=>{};const favsToHotswap=()=>{};${native.handler}\n`+s.slice(end);
   s+=`\nlet isExportPopupOpen=false;const exportPopper={update(){}};${native.outside}`;
   await route.fulfill({status:r.status,headers:r.headers,body:s});
  });
  await p.route('http://127.0.0.1:8773/',async route=>{
   const r=await localResponse(route.request().url());let s=r.body.toString('utf8');
   s=s.replace(/#amily2_drawer_content\{[^}]*\}/g,'');
   s=s.replace('<div id="sys-settings-button">设置</div>',`<div id="sys-settings-button">设置</div><div id="WI-SP-button" class="drawer"><div class="drawer-toggle"><div id="WIDrawerIcon" class="drawer-icon closedIcon" tabindex="0">世界书</div></div><div id="WorldInfo" class="drawer-content closedDrawer">原生世界书面板</div></div><div id="test-settings" class="drawer"><div class="drawer-toggle"><div id="settings-icon" class="drawer-icon closedIcon">设置菜单</div></div><div id="test-native-settings" class="drawer-content closedDrawer">原生设置</div></div>`);
   await route.fulfill({status:r.status,headers:r.headers,body:s});
  });
  await p.addInitScript(()=>localStorage.setItem('amily2_prompt_version','v3.1_soft_prompt'));
  await p.goto('http://127.0.0.1:8773/');await p.locator('.am-app-header').waitFor({state:'attached'});
  await p.addStyleTag({content:`:root{--sheldWidth:700px;--topBarBlockSize:48px;--bottomFormBlockSize:80px;--animation-duration-2x:0s}#top-settings-holder{position:fixed;top:0;left:0;width:100%;height:48px;box-sizing:border-box}.drawer-content{box-sizing:border-box}${native.css}\n${native.mobileCss}`});
  await p.evaluate(async()=>{const {doNavbarIconClick}=await import('/script.js');$('#WI-SP-button>.drawer-toggle,#test-settings>.drawer-toggle').on('click',doNavbarIconClick);});
  const memory=p.locator('#amily2_drawer_content'),world=p.locator('#WorldInfo'),trigger=p.locator('#amily2_drawer_icon');
  await p.locator('#WIDrawerIcon').click();await world.waitFor();const nativeBox=await world.boundingBox();
  await trigger.click();await memory.waitFor();await world.waitFor({state:'hidden'});
  assert.equal(await p.locator('.drawer-content.openDrawer').count(),1);
  const memoryBox=await memory.boundingBox();
  assert.equal(memoryBox.width,nativeBox.width);assert.equal(memoryBox.x,nativeBox.x);assert.equal(memoryBox.y,nativeBox.y);
  assert.equal(await memory.evaluate(n=>n.style.display),'');assert.equal(await memory.evaluate(n=>getComputedStyle(n).zIndex),'auto');assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  await p.locator('#WIDrawerIcon').click();await world.waitFor();await memory.waitFor({state:'hidden'});assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await trigger.click();await memory.waitFor();await p.locator('#settings-icon').click();await memory.waitFor({state:'hidden'});await p.locator('#test-native-settings').waitFor();
  await trigger.click();await memory.waitFor();await p.locator('#test-native-settings').waitFor({state:'hidden'});
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
  await p.locator('#am-app-sidebar [data-route="floors"]').click();
  const jump=p.locator('#amily2_jump_to_message_id');assert(await jump.isVisible());assert.equal(await jump.evaluate(n=>n.closest('[data-page]').dataset.page),'floors');assert.equal(await p.locator('#amily2_jump_to_message_id').count(),1);
  await p.evaluate(()=>{const chat=document.createElement('div');chat.id='chat';document.body.append(chat);for(const id of [11,12,13]){const n=document.createElement('div');n.className='mes';n.setAttribute('mesid',id);n.style.display='none';n.textContent='测试楼层 '+id;n.scrollIntoView=()=>n.dataset.jumpVisited='true';chat.append(n);}});
  await jump.fill('12');await p.locator('#amily2_jump_to_message_btn').click();assert.equal(await p.locator('.mes[mesid="12"]').getAttribute('data-jump-visited'),'true');assert(await p.locator('.mes[mesid="11"]').isVisible());
  await p.evaluate(()=>document.querySelector('.mes[mesid="12"]').removeAttribute('data-jump-visited'));await jump.press('Enter');assert.equal(await p.locator('.mes[mesid="12"]').getAttribute('data-jump-visited'),'true');
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();await p.locator('#am-app-sidebar [data-route="memory"]').click();
  console.log(JSON.stringify({width,jumpEntry:true,clickJump:true,enterJump:true,hiddenContextRestored:true}));
  await p.locator('#amily2_mhb_small_start_floor').fill('15');await trigger.click();await memory.waitFor({state:'hidden'});await trigger.click();await memory.waitFor();assert.equal(await p.locator('#amily2_mhb_small_start_floor').inputValue(),'15');
  await p.mouse.click(width-1,840);await memory.waitFor({state:'hidden'});
  await trigger.focus();await p.keyboard.press('Enter');await memory.waitFor();await p.locator('.am-menu-toggle').focus();await p.keyboard.press('Escape');if(await memory.isVisible())await p.keyboard.press('Escape');await memory.waitFor({state:'hidden'});
  await p.evaluate(()=>{$('#WorldInfo').addClass('pinnedOpen openDrawer').removeClass('closedDrawer');$('#WIDrawerIcon').addClass('drawerPinnedOpen openIcon').removeClass('closedIcon');});
  await trigger.click();await memory.waitFor();assert(await world.isVisible(),'native pinned drawer stays open');await trigger.click();
  await p.evaluate(()=>{$('#WorldInfo').removeClass('pinnedOpen openDrawer').addClass('closedDrawer');$('#WIDrawerIcon').removeClass('drawerPinnedOpen openIcon').addClass('closedIcon');});
  await trigger.click();await memory.waitFor();
  if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
  await p.locator('#am-app-sidebar [data-route="connections"]').click();
  await p.locator('.amily2_profile_card').first().getByRole('button',{name:'编辑',exact:true}).click();await p.locator('#amily2_profile_modal').waitFor();
  await p.keyboard.press('Escape');await p.locator('#amily2_profile_modal').waitFor({state:'hidden'});assert(await memory.isVisible());
  await p.locator('.am-app-exit').click();await memory.waitFor({state:'hidden'});await trigger.click();await memory.waitFor();
  await p.screenshot({path:require('node:os').tmpdir()+'/memory-native-drawer-'+width+'.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,nativeBox,memoryBox,worldMutual:true,settingsMutual:true,pinnedNativeRule:true,noCustomLayer:true,errors}));await p.close();
 }}finally{await b.close();fs.unlinkSync(tempServer);}
})().catch(e=>{console.error(e);process.exitCode=1});
