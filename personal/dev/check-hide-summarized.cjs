const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{Readable}=require('node:stream');
const temp=path.resolve(__dirname,'.offline-hide-'+process.pid+'.mjs');
fs.writeFileSync(temp,fs.readFileSync(path.resolve(__dirname,'server.mjs'),'utf8').replace(/server\.listen\(8773[\s\S]*$/,'export default server;'));
(async()=>{
  const server=(await import(pathToFileURL(temp).href)).default,serve=server.listeners('request')[0];
  const response=(url,body)=>new Promise((resolve,reject)=>{
    const headers={};let status=200;const req=Readable.from(body?[body]:[]);req.url=new URL(url).pathname;req.method=body?'POST':'GET';
    const res={setHeader(k,v){headers[k.toLowerCase()]=v},writeHead(code){status=code;return res;},end(content){resolve({status,headers,body:Buffer.from(content||'')});},get statusCode(){return status;},set statusCode(v){status=v;}};
    Promise.resolve(serve(req,res)).catch(reject);
  });
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try{for(const width of [320,375,1280]){
    const p=await browser.newPage({viewport:{width,height:844}});p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',error=>errors.push(error.message));
    await p.addInitScript(()=>{globalThis.floorCommands=[];globalThis.floorBook={entries:{0:{uid:0,comment:'[Memory]总结',disable:false,content:'保留剧情\n\n本条勿动【前170楼总结已完成】否则后续总结无法进行。'}}};});
    await p.route('http://127.0.0.1:8773/**',async route=>{
      const req=route.request(),pathname=new URL(req.url()).pathname;
      if(pathname.startsWith('/scripts/')&&!pathname.startsWith('/scripts/extensions/third-party/Memory/'))return route.fulfill({contentType:'text/javascript',body:"export * from '/script.js';"});
      const r=await response(req.url(),req.postDataBuffer());
      if(new URL(req.url()).pathname==='/script.js'){
        let s=r.body.toString('utf8');
        s=s.replace(/export const loadWorldInfo=async name=>[\s\S]*?;export const saveWorldInfo=/,"export const loadWorldInfo=async()=>{await new Promise(resolve=>setTimeout(resolve,30));return globalThis.floorBook;};export const saveWorldInfo=");
        const start=s.indexOf('export const SlashCommandParser=class'),end=s.indexOf('\n',start);assert(start>=0&&end>start);
        s=s.slice(0,start)+"export const SlashCommandParser=class{parse(command){return{execute:async()=>{globalThis.floorCommands.push(command);const match=command.match(/^\\/(hide|unhide) (\\d+)-(\\d+)$/);if(!match)throw Error('unexpected command');for(let i=+match[2];i<=+match[3];i++)getContext().chat[i].is_system=match[1]==='hide';}};}};"+s.slice(end);
        return route.fulfill({...r,body:s});
      }
      await route.fulfill(r);
    });
    await p.goto('http://127.0.0.1:8773/');await p.locator('.am-app-header').waitFor({state:'attached'});
    await p.evaluate(()=>{previewContext.extensionSettings.Memory.lorebookTarget='character_main';previewContext.extensionSettings.Memory.autoHideEnabled=false;previewContext.extensionSettings.Memory.autoHideSummarizedEnabled=false;});
    await p.locator('#amily2_drawer_icon').click();if(await p.locator('.am-menu-toggle').getAttribute('aria-expanded')==='false')await p.locator('.am-menu-toggle').click();
    await p.locator('#am-app-sidebar [data-route="floors"]').click();
    const hide=p.locator('#amily2_hide_summarized_button'),show=p.locator('#amily2_unhide_all_button');await hide.waitFor({state:'visible'});await show.waitFor({state:'visible'});
    assert(await hide.evaluate(element=>element.parentElement===document.querySelector('#amily2_unhide_all_button').parentElement));
    assert(await hide.evaluate(element=>element.getBoundingClientRect().right<=innerWidth&&element.getBoundingClientRect().width>=100));
    const disabled=await hide.evaluate(element=>{element.click();return element.disabled;});assert(disabled);
    await p.waitForFunction(()=>floorCommands.includes('/hide 0-169'));await p.waitForFunction(()=>!document.querySelector('#amily2_hide_summarized_button').disabled);
    const flags=await p.evaluate(()=>previewContext.chat.map(message=>Boolean(message.is_system)));assert(flags.slice(0,170).every(Boolean));assert(flags.slice(170).every(value=>!value));
    await show.click();await p.waitForFunction(()=>floorCommands.includes('/unhide 0-244'));assert((await p.evaluate(()=>previewContext.chat.map(message=>Boolean(message.is_system)))).every(value=>!value));
    await p.evaluate(()=>{floorBook.entries[0].content='保留剧情\n\n本条勿动【前100楼总结已完成】否则后续总结无法进行。';});
    await hide.click();await p.waitForFunction(()=>floorCommands.includes('/hide 0-99'));await p.waitForFunction(()=>!document.querySelector('#amily2_hide_summarized_button').disabled);
    assert(await p.evaluate(()=>previewContext.extensionSettings.Memory.autoHideEnabled===false&&previewContext.extensionSettings.Memory.autoHideSummarizedEnabled===false));
    await p.screenshot({path:path.resolve(__dirname,'../../../qa-tools/hide-summarized-'+width+'.png')});assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,adjacentButtons:true,hiddenSummarizedOnly:true,showAllWorks:true,manualProgressChangeRespected:true,settingsUnchanged:true,errors}));await p.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.unlinkSync(temp));
