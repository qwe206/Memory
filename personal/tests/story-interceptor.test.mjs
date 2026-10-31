import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const {parse} = createRequire(import.meta.url)('acorn');
const {stripSummarySources}=await import('data:text/javascript;base64,'+Buffer.from(await fs.readFile(new URL('../ledger.js',import.meta.url),'utf8')).toString('base64'));
const main = await fs.readFile(new URL('../main.js',import.meta.url),'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('../../manifest.json',import.meta.url),'utf8'));
const tree = parse(main,{ecmaVersion:'latest',sourceType:'module'});
const start = tree.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='start');
const assignment = start.body.body.find(node=>node.type==='ExpressionStatement'&&node.expression.type==='AssignmentExpression'&&node.expression.left.property?.name==='memory_rearrangeChat');

test('Memory registers its own host generation interceptor without replacing the built-in vector extension',()=>{
  assert.equal(manifest.generate_interceptor,'memory_rearrangeChat');assert(assignment);
  assert(!main.includes('window.vectors_rearrangeChat ='));
});

test('the registered interceptor injects continued-story summary and runs memory retrieval independently',async()=>{
  let chatId='C',retrievals=0,archived=false;
  const prompts=[];
  const fixture={stripSummarySources,window:{hanlinyuanRagProcessor:{rearrangeChat:async()=>{retrievals++;}}},
    setExtensionPrompt:(key,value)=>prompts.push({key,value}),
    chatKey:context=>context.chatId,getContext:()=>({chatId,characterId:0,characters:[{data:{extensions:{world:'A-book'}}}]}),
    getMemoryStoryContext:()=>({story:{worldbook:'B-book',archived}}),getTargetLorebookName:async()=> 'B-book',
    loadWorldInfo:async()=>({entries:{0:{content:'B 的总结'}}}),findActiveSummary:book=>book?.entries[0]};
  const keys=Object.keys(fixture);
  new Function(...keys,main.slice(assignment.start,assignment.end))(...keys.map(key=>fixture[key]));
  await fixture.window.memory_rearrangeChat([],4096,()=>{},'normal');
  assert.equal(retrievals,1);assert(prompts.some(prompt=>prompt.value.includes('B 的总结')));
  prompts.length=0;archived=true;await fixture.window.memory_rearrangeChat([]);
  assert(!prompts.some(prompt=>prompt.value),'archived summaries must not be injected');
  prompts.length=0;archived=false;
  fixture.loadWorldInfo=async()=>{chatId='D';return {entries:{0:{content:'B 的总结'}}};};
  new Function(...keys,main.slice(assignment.start,assignment.end))(...keys.map(key=>fixture[key]));
  await fixture.window.memory_rearrangeChat([]);
  assert.equal(retrievals,2);assert(!prompts.some(prompt=>prompt.value),'a chat switch must cancel stale summary injection');
});
