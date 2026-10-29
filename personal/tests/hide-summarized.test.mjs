import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const {parse}=createRequire(import.meta.url)('acorn');
const source=await fs.readFile(new URL('../../core/autoHideManager.js',import.meta.url),'utf8');
const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const code=tree.body.filter(node=>node.type!=='ImportDeclaration').map(node=>source.slice(node.start,node.end)).join('\n');

async function harness(length=605) {
  const chat=Array.from({length},()=>({mes:'raw',is_system:false})),commands=[],notices=[];
  const settings={autoHideEnabled:false,autoHideSummarizedEnabled:false};
  let chatId='A',revision=0,recovering=false,book='book',progress=570,onRead;
  const context=()=>({chat,characterId:0,chatId});
  const fixture={getContext:context,extension_settings:{test:settings},extensionName:'test',
    chatKey:ctx=>ctx.chatId,isMemoryRecovering:()=>recovering,getRecoveryRevision:()=>revision,
    getTargetLorebookName:async()=>book,readGoldenLedgerProgress:async()=>{await onRead?.();return progress;},
    SlashCommandParser:class {parse(command){return{execute:async()=>{commands.push(command);const [,type,start,end]=command.match(/^\/(hide|unhide) (\d+)-(\d+)$/);for(let i=+start;i<=+end;i++)chat[i].is_system=type==='hide';}};}},
    notify:{info:message=>notices.push(message),success:message=>notices.push(message),error:message=>notices.push(message)}};
  globalThis.__floorFixture=fixture;
  const declarations=tree.body.filter(node=>node.type==='ImportDeclaration').flatMap(node=>node.specifiers.map(spec=>`const ${spec.local.name}=globalThis.__floorFixture[${JSON.stringify(spec.imported?.name||'default')}];`)).join('\n');
  const module=await import('data:text/javascript;base64,'+Buffer.from(declarations+'\n'+code+'\n//# sourceURL=manual-floor-test-'+Math.random()+'.js').toString('base64'));
  return{module,chat,commands,settings,notices,progress:value=>{progress=value;},book:value=>{book=value;},onRead:fn=>{onRead=fn;},switchChat:()=>{chatId='B';},recover:()=>{revision++;},busy:()=>{recovering=true;}};
}

test('one click hides the complete summarized prefix without DOM requirements or changing settings and tail',async()=>{
  const h=await harness();h.chat[580].is_system=true;const tail=structuredClone(h.chat.slice(570)),settings=structuredClone(h.settings);
  await h.module.executeManualCommand('hide_summarized');assert.deepEqual(h.commands,['/hide 0-569']);
  assert(h.chat.slice(0,570).every(message=>message.is_system));assert.deepEqual(h.chat.slice(570),tail);assert.deepEqual(h.settings,settings);
  await h.module.executeManualCommand('unhide_all');assert(h.chat.every(message=>!message.is_system));
});

test('each click reads current worldbook progress and clamps to available messages',async()=>{
  const h=await harness(5);h.progress(1);await h.module.executeManualCommand('hide_summarized');
  assert.deepEqual(h.commands,['/hide 0-0']);h.progress(100);await h.module.executeManualCommand('hide_summarized');assert.equal(h.commands.at(-1),'/hide 0-4');
});

test('missing progress, missing worldbook and empty chat do not execute hiding',async()=>{
  const h=await harness();h.progress(0);await h.module.executeManualCommand('hide_summarized');h.book(null);await h.module.executeManualCommand('hide_summarized');
  assert.deepEqual(h.commands,[]);assert(h.notices.length>=2);const empty=await harness(0);await empty.module.executeManualCommand('hide_summarized');assert.deepEqual(empty.commands,[]);
});

test('chat switches and archive recovery while reading progress cancel the action',async()=>{
  const h=await harness();h.onRead(h.switchChat);await h.module.executeManualCommand('hide_summarized');assert.deepEqual(h.commands,[]);
  const recovered=await harness();recovered.onRead(recovered.recover);await recovered.module.executeManualCommand('hide_summarized');assert.deepEqual(recovered.commands,[]);
  const busy=await harness();busy.busy();await busy.module.executeManualCommand('hide_summarized');assert.deepEqual(busy.commands,[]);
});

test('invalid or unreadable worldbook progress never hides messages',async()=>{
  const h=await harness();h.progress(NaN);await assert.rejects(h.module.executeManualCommand('hide_summarized'),/进度无效/);assert.deepEqual(h.commands,[]);
  h.onRead(()=>{throw new Error('worldbook failed');});await assert.rejects(h.module.executeManualCommand('hide_summarized'),/worldbook failed/);assert.deepEqual(h.commands,[]);
});
