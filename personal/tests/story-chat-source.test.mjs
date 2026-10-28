import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const load = text => import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
const { readStoryChat, storyChatFingerprint } = await load(await fs.readFile(new URL('../story-chat-source.js', import.meta.url), 'utf8'));
const { confirmStoryLedgerWrite } = await load(await fs.readFile(new URL('../story-ledger-write.js', import.meta.url), 'utf8'));

test('historical character chats use the read-only ST endpoint and exclude only the metadata header', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,...options});return{ok:true,json:async()=>[{chat_metadata:{},user_name:'user'},{mes:'old tail',is_user:false}]};});
  const context={chatId:'C',chat:[{mes:'live'}],characterId:0,characters:[{avatar:'role.png'}],getRequestHeaders:()=>({'X-CSRF-Token':'fixture'})};
  assert.equal((await readStoryChat(context,'B'))[0].mes,'old tail');
  assert.equal(calls[0].url,'/api/chats/get');
  assert.deepEqual(JSON.parse(calls[0].body),{avatar_url:'role.png',file_name:'B'});
  assert.equal(context.chatId,'C'); assert.equal(context.chat[0].mes,'live');
  assert.strictEqual(await readStoryChat(context,'C'),context.chat);assert.equal(calls.length,1);
});

test('group history uses the group-chat file identifier without dropping its first message', async t => {
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,...options});return{ok:true,json:async()=>[{mes:'group first'},{mes:'group tail'}]};});
  const context={groupId:5,chatId:'C',getRequestHeaders:()=>({})};
  assert.equal((await readStoryChat(context,'B')).length,2);
  assert.equal(calls[0].url,'/api/chats/group/get');assert.deepEqual(JSON.parse(calls[0].body),{id:'B'});
});

test('corrupt history and HTTP errors stop catch-up; they do not silently drop messages', async t => {
  const context={chatId:'C',groupId:5,getRequestHeaders:()=>({})};
  t.mock.method(globalThis,'fetch',async()=>({ok:false,status:500}));
  await assert.rejects(readStoryChat(context,'B'),/HTTP 500/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({})});await assert.rejects(readStoryChat(context,'B'),/格式异常/);
  globalThis.fetch=async()=>({ok:true,json:async()=>[{chat_metadata:{}},{mes:'first'},{mes:null}]});
  await assert.rejects(readStoryChat(context,'B'),/无法读取/);
});

test('message-source checks ignore visibility flags and detect text edits or deleted messages', () => {
  const chat=[{mes:'first',is_user:true,send_date:'date'},{mes:'tail',is_user:false}];
  const initial=storyChatFingerprint(chat,1,2);chat[0].is_system=true;
  assert.equal(storyChatFingerprint(chat,1,2),initial);chat[1].mes='edited';
  assert.notEqual(storyChatFingerprint(chat,1,2),initial);chat.pop();
  assert.notEqual(storyChatFingerprint(chat,1,2),initial);
});

test('actual native worldbook writer treats a false save as failure and preserves the cached original object', async () => {
  const {parse}=createRequire(import.meta.url)('acorn');
  const source=await fs.readFile(new URL('../../core/tavernhelper-compatibility.js',import.meta.url),'utf8');
  const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.declaration||n).find(n=>n.type==='FunctionDeclaration'&&n.id.name==='compatibleWriteToLorebook');
  const original={entries:{1:{comment:'summary',disable:false,content:'original'}}};
  const fixture={withLoreLock:async(_key,action)=>action(),isTavernHelperAvailable:()=>false,loadWorldInfo:async()=>original,saveWorldInfo:async()=>false,toastr:{error(){},warning(){}}};
  const keys=Object.keys(fixture);
  const write=new Function(...keys,source.slice(node.start,node.end)+';return compatibleWriteToLorebook;')(...keys.map(key=>fixture[key]));
  assert.equal(await write('book','summary',()=> 'new summary'),false);
  assert.equal(original.entries[1].content,'original');
});

test('server confirmation detects ST false-success saves and clears the stale cache before retrying', async t => {
  let persisted='old summary',invalidated=0;const requests=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,...options});return{ok:true,json:async()=>({entries:{1:{disable:false,content:persisted}}})};});
  const context={getRequestHeaders:()=>({})};
  await assert.rejects(confirmStoryLedgerWrite(context,'book','new summary',()=>{invalidated++;}),/回读不一致/);
  assert.equal(invalidated,1); assert.equal(requests[0].cache,'no-cache');
  assert.equal(requests[0].url,'/api/worldinfo/get');assert.deepEqual(JSON.parse(requests[0].body),{name:'book'});
  persisted='new summary'; await confirmStoryLedgerWrite(context,'book','new summary',()=>{invalidated++;});
  assert.equal(invalidated,1);
});
