import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
const root=fileURLToPath(new URL('../../',import.meta.url)), prefix='/scripts/extensions/third-party/Memory/';
const hostNames=new Map(),seen=new Set();
async function scan(file){if(seen.has(file))return;seen.add(file);let source;try{source=await fs.readFile(file,'utf8')}catch{return}let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module'})}catch{return}
for(const node of ast.body){if(!node.source)continue;const source=node.source.value;if(source.startsWith('.'))await scan(path.resolve(path.dirname(file),source));else if(source.startsWith('/')){const names=hostNames.get(source)||new Set();for(const spec of node.specifiers||[])if(spec.imported)names.add(spec.imported.name);hostNames.set(source,names);}}}
await scan(path.join(root,'personal/main.js'));
const host=`
export const chat=Array.from({length:245},(_,i)=>({name:i%2?'林渡':'用户',is_user:i%2===0,mes:'第'+(i+1)+'楼：在书店发现铜钥匙。'}));
export const characters=[{name:'林渡',avatar:'preview.png',data:{extensions:{world:'演示世界书'}}}];
export const extension_settings={'Memory':{amily2_profiles:[
{id:'chat-demo',name:'日常总结 · 很长的连接配置名称测试',type:'chat',provider:'openai',apiUrl:'https://api.example.invalid/v1',model:'【模型】deepseek-v4.1-flash-long-context-2026-very-long-model-name',maxTokens:8192,temperature:0.7},
{id:'embed-demo',name:'向量嵌入',type:'embedding',provider:'openai',apiUrl:'https://embedding.example.invalid/v1',model:'BAAI/bge-m3-multilingual-embedding'},
{id:'rerank-demo',name:'检索精排',type:'rerank',provider:'openai',apiUrl:'https://rerank.example.invalid/v1',model:'rerank-multilingual-v3.5'}
],amily2_profile_assignments:{main:'chat-demo',ngms:'chat-demo',ragEmbed:'embed-demo',ragRerank:'rerank-demo'}}}; export const chat_metadata={}; export const extension_prompts={};
extension_settings['hanlinyuan-rag-core']={knowledgeBases:{'林渡':{'demo-chunks':{id:'demo-chunks',name:'演示：大总结 1–438楼',source:'lorebook',enabled:true}},'_global':{}}};
export const event_types=new Proxy({}, {get:(_,key)=>key}); const listeners=new Map();
export const eventSource={on:(key,fn)=>{listeners.set(key,[...(listeners.get(key)||[]),fn]);},emit:async(key,...args)=>{for(const fn of listeners.get(key)||[])await fn(...args)}};
export const extension_prompt_roles={SYSTEM:0,USER:1,ASSISTANT:2};
export const getRequestHeaders=()=>({'Content-Type':'application/json'});
export const saveSettingsDebounced=()=>{};
export const power_user={}; export const world_info={}; export const selected_world_info=[]; export const world_names=['演示世界书','旧Amily总结-8','错误旧书'];
export const currentUser={handle:'preview'};export const accountsEnabled=false;export const getCurrentUserHandle=()=> 'preview';
export const this_chid=0;export const name1='用户';export const name2='林渡';
export const getContext=()=>({chat,characters,characterId:0,chatId:'preview',name1,name2,extensionSettings:extension_settings,getCurrentChatId:()=> 'preview',getRequestHeaders,eventSource,eventTypes:event_types,chatMetadata:chat_metadata,saveSettingsDebounced,generateRaw:async()=> '示例总结正文'});
export const loadWorldInfo=async name=>name==='旧Amily总结-8'?{entries:{7:{comment:'【敕史局】对话流水总帐',content:'以下内容是【1楼-60楼】已发生的剧情回顾。\\n\\n---\\n\\n第1天发现铜钥匙。\\n\\n【前60楼篇章编撰已完成】\\n\\n【61楼至90楼详细总结记录】\\n第二天归还铜钥匙。\\n\\n本条勿动【前90楼总结已完成】否则后续总结无法进行。'}}}:name==='错误旧书'?{entries:{7:{comment:'【敕史局】对话流水总帐',content:'broken'}}}:{entries:{}};export const saveWorldInfo=async()=>{};
export const renderExtensionTemplateAsync=async(name,file)=>fetch('${prefix}'+file+'.html').then(r=>r.text());
// Minimal host double; native parity is separately checked against official ST fixtures.
export async function doNavbarIconClick(){
 const panel=$(this).parent().children('.drawer-content');const icon=$(this).find('.drawer-icon');const wasOpen=panel.hasClass('openDrawer');
 if(!wasOpen){$('.drawer-content.openDrawer:not(.pinnedOpen)').removeClass('openDrawer').addClass('closedDrawer');$('.drawer-icon.openIcon:not(.drawerPinnedOpen)').removeClass('openIcon').addClass('closedIcon');}
 panel.toggleClass('openDrawer',!wasOpen).toggleClass('closedDrawer',wasOpen);icon.toggleClass('openIcon',!wasOpen).toggleClass('closedIcon',wasOpen);
}
export const getSlideToggleOptions=()=>({});export const slideToggle=element=>{element.style.display=element.style.display==='none'?'block':'none'};
export const messageFormatting=text=>text;export const substituteParamsExtended=text=>text;
export const Popup=class{static show={confirm:async()=>true,input:async()=>null,text:async()=>true};};
export const POPUP_TYPE={TEXT:1,CONFIRM:2};export const POPUP_RESULT={AFFIRMATIVE:1};export const callGenericPopup=async()=>1;
export const SlashCommandParser=class{parse(){return{execute:async()=>{}}}};
`;
const declared=new Set([...host.matchAll(/export (?:const|async function) (\w+)/g)].map(m=>m[1]));
const previewChunks=Array.from({length:26},(_,i)=>({hash:1000+i,index:i,text:`<summary>\n[来源: 演示世界书, 条目: 大总结, 第${i+1}部分]\n第${i+1}块：书店里的铜钥匙被交给林渡。${i===0?'安全展示测试：<img src=x onerror="window.chunkUnsafe=true">':''}\n</summary>`}));
previewChunks[1].text=previewChunks[0].text; // Deliberate old-data duplicate for the read-only audit UI.
let hostCode=host;for(const names of hostNames.values())for(const name of names)if(!declared.has(name)){declared.add(name);hostCode+=`\nexport const ${name}=(...args)=>{};`;}
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memory · 模拟验证</title><link rel="stylesheet" href="${prefix}personal/fullscreen-ui.css"><style>body{margin:0;background:#222;color:#ddd;font:14px system-ui;--SmartThemeBodyColor:#ddd;--SmartThemeBlurTintColor:#292d35;--SmartThemeBorderColor:#555;--SmartThemeQuoteColor:#8ec7ee}#top-settings-holder{display:flex;padding:8px;gap:12px}.drawer-content{display:none;position:absolute;top:var(--topBarBlockSize,48px);left:0;right:0;margin:0 auto;width:var(--sheldWidth,min(700px,100vw));max-height:calc(100dvh - 100px);box-sizing:border-box;background:#292d35;padding:5px;border:1px solid #555;border-radius:10px}.drawer-content.openDrawer{display:block}.drawer-icon{cursor:pointer}.menu_button{background:#343b45;border:1px solid #555;color:#eee;border-radius:5px;padding:8px;cursor:pointer}.text_pole,input,textarea,select{background:#222;color:#eee;border:1px solid #555;padding:8px}.notes{font-size:12px;color:#aaa}#preview-note{padding:8px;color:#aaa}fieldset{border:1px solid #555}button{color:inherit}#preview-errors{white-space:pre-wrap;color:#ffaaaa}</style><body><div id="preview-note">原版模块 + 模拟酒馆主机 / API，不访问实际聊天或服务</div><div id="top-settings-holder"><div id="sys-settings-button">设置</div></div><div id="extensions_settings2"></div><pre id="preview-errors"></pre><script src="/jquery.js"></script><script>globalThis.toastr=new Proxy({},{get:(_,kind)=>(...args)=>console.log(kind,...args)});globalThis.SillyTavern={getContext:()=>globalThis.previewContext};$.fn.select2=function(){return this};$('html').on('mousedown touchstart',event=>{const target=$(event.target);if(target.closest('.drawer-icon,.openDrawer,dialog,.popup,.text_pole').length)return;$('.drawer-content.openDrawer:not(.pinnedOpen)').removeClass('openDrawer').addClass('closedDrawer');$('.drawer-icon.openIcon:not(.drawerPinnedOpen)').removeClass('openIcon').addClass('closedIcon');});window.addEventListener('error',e=>document.querySelector('#preview-errors').textContent+=e.message+'\\n');window.addEventListener('unhandledrejection',e=>document.querySelector('#preview-errors').textContent+=(e.reason?.message||e.reason)+'\\n');</script><script type="module">import{getContext}from'/script.js';globalThis.previewContext=getContext();await import('${prefix}personal/main.js');</script></body></html>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');const w=Math.max(320,Math.min(1024,Number(url.searchParams.get('w'))||375));const h=Number(url.searchParams.get('h'))||660;res.end(url.searchParams.has('mobile') ? `<!doctype html><html><meta name=viewport content="width=device-width,initial-scale=1"><body style="background:#bbb;margin:12px"><iframe title="${w}px 手机预览" style="display:block;width:${w}px;height:${h}px;margin:auto;border:0" src="/?embedded=1&skin=1"></iframe></body></html>` : (url.searchParams.has('skin') ? html.replace('<body>', '<style>body{font-family:cursive;font-size:30px;color:#723700}button,input,select{font-family:cursive;font-size:30px;background:#cab89c;color:#723700}</style><body>') : html));return}if(url.pathname==='/jquery.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(new URL('../../node_modules/jquery/dist/jquery.js',import.meta.url)));return}
if(hostNames.has(url.pathname)||['/script.js','/scripts/world-info.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(hostCode);return}
if(['/api/vector/list','/api/vector/query'].includes(url.pathname)){
let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
const rows=body.collectionId?.endsWith('_demo-chunks')?previewChunks:[];
res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.endsWith('/list')?rows.map(row=>row.hash):{metadata:rows}));return}
if(url.pathname==='/api/backends/chat-completions/generate'){
let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
res.setHeader('Content-Type','application/json');
if(!body.model || body.model.startsWith('missing')){res.statusCode=404;res.end(JSON.stringify({error:{message:'所选模型不可用'}}));return}
if(body.proxy_password!=='test-only-not-a-real-key'){res.statusCode=401;res.end(JSON.stringify({error:{message:'模拟密钥未正确复用'}}));return}
res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));return}
if(url.pathname==='/api/backends/chat-completions/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'deepseek-v4.1-flash-long-context-2026-very-long-model-name'},{id:'embedding-multilingual'}]}));return}if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([]));return}
let relative=decodeURIComponent(url.pathname.slice(prefix.length));if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return}
const target=path.resolve(root,relative);if(!target.startsWith(root)){res.writeHead(403).end();return}
res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(target)]||'application/octet-stream');res.end(await fs.readFile(target));
}catch(error){res.writeHead(404).end(error.message)}});
server.listen(8773,'127.0.0.1',()=>console.log('Original UI preview http://127.0.0.1:8773'));
