const { chromium } = require(process.env.AMILY_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const output = process.env.AMILY_QA_OUTPUT || path.resolve('outputs/workspace-ui');
fs.mkdirSync(output, { recursive: true });
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.AMILY_BROWSER_EXECUTABLE || undefined});
  try { for(const width of [320,375,1280]) {
    const p=await browser.newPage({viewport:{width,height:844}});p.setDefaultTimeout(7000);
    const errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.route('https://embedding.example.invalid/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{embedding:[0.1,0.3]}]})}));
    await p.addInitScript(()=>{
      localStorage.setItem('amily2_prompt_version','v3.1_soft_prompt');
      const append=Element.prototype.append;
      HTMLDialogElement.prototype.append=function(...nodes){
        if(this.id==='am-memory-app'&&nodes[0]?.id==='amily2_chat_optimiser')window.beforeWorkspace=[...nodes[0].querySelectorAll('input,select,textarea,button')];
        return append.apply(this,nodes);
      };
    });
    await p.goto('http://127.0.0.1:8773/?skin=1');
    await p.locator('.am-app-header').waitFor({state:'attached'});
    await p.locator('#amily2_drawer_icon').click();
    await p.locator('#am-memory-app').waitFor();
    assert.equal(await p.locator('.am-sidebar-head strong').textContent(),'Memory');
    await p.addStyleTag({content:"input[type='checkbox'] { appearance:none; width:18px; height:18px; border:1px solid #778899; border-radius:4px; accent-color:#8899aa; } input[type='checkbox']:checked { background-color:#668877; }"});
    await p.evaluate(()=>{const reference=document.createElement('input');reference.type='checkbox';reference.id='host-checkbox-reference';reference.checked=true;document.body.append(reference);});
    async function checkHostAppearance() {
      const appearance=await p.evaluate(()=>{
        const host=getComputedStyle(document.querySelector('#host-checkbox-reference'));
        const input=document.querySelector('#amily2_ngms_enabled');input.checked=true;
        const own=getComputedStyle(input);
        return ['appearance','width','height','borderRadius','accentColor','backgroundColor'].map(key=>[key,own[key],host[key]]);
      });
      for(const [key,own,host]of appearance)assert.equal(own,host,`host checkbox ${key}`);
    }
    await checkHostAppearance();
    await p.evaluate(()=>{document.body.style.fontFamily='Georgia, serif';});
    await p.waitForFunction(()=>getComputedStyle(document.querySelector('.am-app-exit')).fontFamily===getComputedStyle(document.body).fontFamily);
    await p.evaluate(()=>{document.body.style.fontFamily='cursive';});
    await p.waitForFunction(()=>getComputedStyle(document.querySelector('.am-app-exit')).fontFamily===getComputedStyle(document.body).fontFamily);
    const retained=await p.evaluate(()=>({before:beforeWorkspace.length,missing:beforeWorkspace.filter(n=>!document.querySelector('#amily2_chat_optimiser').contains(n)).map(n=>n.id),duplicates:[...document.querySelectorAll('#am-memory-app [id]')].map(n=>n.id).filter((id,i,a)=>a.indexOf(id)!==i)}));
    assert.deepEqual(retained.missing,[]);assert.deepEqual(retained.duplicates,[]);
    const nav=p.getByRole('navigation',{name:'聊天记忆导航'});
    async function go(route) {
      if(width<860)await p.locator('.am-menu-toggle').click();
      try { await nav.locator(`[data-route="${route}"]`).click(); } catch(e) { console.log('OPEN POPUPS',await p.locator('dialog.popup[open]').allTextContents());throw e; }
      assert.equal(await p.locator('#amily2_chat_optimiser').getAttribute('data-route'),route);
    }
    const routes=await p.locator('#am-app-sidebar [data-route]').evaluateAll(nodes=>nodes.map(n=>n.dataset.route));
    assert(!routes.includes('appearance'));
    assert.equal(await p.locator('#am-app-sidebar nav [data-route] .am-icon').count(), routes.length);
    assert.equal(await p.locator('.am-menu-toggle .am-icon').count(),1);
    for(const route of routes) {
      await go(route);
      if(route==='independent') {
        await p.locator('#amily2_ngms_enabled').uncheck();await p.locator('#amily2_ngms_enabled').check();
        await p.locator('.amily2_profile_status_card[data-card-slot="ngms"]').waitFor();
        assert.equal(await p.locator('.am-connection-facts dd').count(),3);
      }
      if(['independent','connections','world','floors','kb-retrieval','kb-historiography','kb-advanced','kb-knowledge-bases','kb-rerank'].includes(route))await p.screenshot({path:path.join(output,`organized-${route}-${width}.png`)});
      const geometry=await p.locator('.am-work-content').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));
      assert(geometry.scroll<=geometry.client+1,`${width} ${route} overflow: ${JSON.stringify(geometry)}`);
      const disclosures=p.locator('.am-work-content .am-settings-fold:visible');
      await disclosures.evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
      if(route==='kb-rerank')await p.screenshot({path:path.join(output,`priority-expanded-${width}.png`)});
      const expanded=await p.locator('.am-work-content').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));
      assert(expanded.scroll<=expanded.client+1,`${width} ${route} expanded overflow: ${JSON.stringify(expanded)}`);
      await p.locator('.am-work-content .am-settings-fold').evaluateAll(nodes=>nodes.forEach(n=>n.open=false));
    }
    await go('world');
    const oldBook=p.locator('#am-existing-summary-book');
    await oldBook.selectOption('旧Amily总结-8');await p.waitForFunction(()=>!document.querySelector('#am-existing-summary-book').disabled);
    assert.equal(await p.evaluate(async()=>{const m=await import('/scripts/extensions/third-party/Memory/core/historiographer.js');return m.getTargetLorebookName();}),'旧Amily总结-8');
    await oldBook.selectOption('错误旧书');await p.waitForFunction(()=>!document.querySelector('#am-existing-summary-book').disabled);
    assert.equal(await oldBook.inputValue(),'旧Amily总结-8');
    await oldBook.selectOption('旧Amily总结-8');await p.waitForFunction(()=>!document.querySelector('#am-existing-summary-book').disabled);
    await p.screenshot({path:path.join(output,`legacy-book-${width}.png`)});
    await go('memory');await p.locator('.am-memory-status').filter({hasText:'已总结至 90 楼'}).waitFor();
    assert((await p.locator('.am-memory-entries').textContent()).includes('第1天发现铜钥匙'));
    assert((await p.locator('.am-memory-entries').textContent()).includes('第二天归还铜钥匙'));
    await go('world');await oldBook.selectOption('');await p.waitForFunction(()=>!document.querySelector('#am-existing-summary-book').disabled);
    await p.evaluate(async()=>{
      const {showSummaryModal}=await import('/scripts/extensions/third-party/Memory/ui/page-window.js');
      window.regenerationCalls=[];window.regenerationFailure=false;window.previewCancelled=false;
      showSummaryModal('第一版：未知日期(1d)，发现钥匙。',{
        onRegenerate:async(_,options)=>{window.regenerationCalls.push(options);if(window.regenerationFailure)throw Error('模拟连接失败');return '修订版：'+(options.requirements||'按原始输入重做');},
        onConfirm:text=>{window.confirmedPreview=text;},onCancel:()=>{window.previewCancelled=true;},
      });
    });
    const preview=p.locator('dialog').filter({has:p.locator('.historiographer-summary-modal')});
    await preview.getByRole('button',{name:'重新生成',exact:true}).click();
    const requirements=p.locator('.am-regenerate-dialog');
    await requirements.locator('textarea').fill('根据后面的6月10日重新梳理第1天、第2天');
    assert(await requirements.locator('textarea').evaluate(n=>n===document.activeElement));
    const modalGeometry=await requirements.evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth,client:n.clientWidth}));
    assert(modalGeometry.width<=width);assert(modalGeometry.scroll<=modalGeometry.client+1);
    await p.screenshot({path:path.join(output,`regeneration-${width}.png`)});
    await requirements.getByRole('button',{name:'重新生成',exact:true}).click();await requirements.waitFor({state:'hidden'});
    assert((await preview.locator('textarea').inputValue()).includes('6月10日'));
    assert.equal(await p.evaluate(()=>window.regenerationCalls[0].firstDraft),'第一版：未知日期(1d)，发现钥匙。');
    await preview.getByRole('button',{name:'重新生成',exact:true}).click();
    await requirements.getByRole('button',{name:'重新生成',exact:true}).click();await requirements.waitFor({state:'hidden'});
    assert.equal(await p.evaluate(()=>window.regenerationCalls[1].requirements),'');
    const beforeFailure=await preview.locator('textarea').inputValue();
    await p.evaluate(()=>{window.regenerationFailure=true;});await preview.getByRole('button',{name:'重新生成',exact:true}).click();
    await requirements.locator('textarea').fill('再次校正');await requirements.getByRole('button',{name:'重新生成',exact:true}).click();
    await requirements.locator('.am-regenerate-status').filter({hasText:'生成失败'}).waitFor();
    assert.equal(await preview.locator('textarea').inputValue(),beforeFailure);
    await p.keyboard.press('Escape');await requirements.waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.previewCancelled),false);
    await preview.getByRole('button',{name:'确认写入',exact:true}).click();await preview.waitFor({state:'hidden'});
    assert.equal(await p.evaluate(()=>window.confirmedPreview),beforeFailure);
    await go('floors');await p.locator('#amily2_auto_hide_threshold').fill('42');await p.locator('#amily2_auto_hide_threshold').dispatchEvent('input');
    await p.locator('#amily2_auto_hide_threshold').dispatchEvent('change');
    assert.equal(await p.evaluate(async()=>{const m=await import('/scripts/extensions.js');return m.extension_settings['Memory'].autoHideThreshold;}),42);
    await go('automatic');await p.locator('#historiography_retention_count').fill('7');await p.locator('#historiography_retention_count').dispatchEvent('change');
    assert.equal(await p.evaluate(async()=>{const m=await import('/scripts/extensions.js');return m.extension_settings['Memory'].historiographyRetentionCount;}),7);
    await p.locator('#am-large-auto-every').fill('3');await p.locator('#am-large-auto-every').dispatchEvent('change');
    assert.equal(await p.evaluate(async()=>{const m=await import('/scripts/extensions.js');return m.extension_settings['Memory'].historiographyLargeAutoEvery;}),3);
    await p.screenshot({path:path.join(output,`auto-large-${width}.png`)});
    await go('prompts');assert(await p.locator('#amily2_mhb_small_editor').isVisible());assert(await p.locator('#amily2_mhb_large_editor').isVisible());
    assert(!/微言录|宏史卷|皇家史官|酒馆国家/.test(await p.locator('#amily2_mhb_small_editor').inputValue()));
    assert(!/微言录|宏史卷|皇家史官|酒馆国家/.test(await p.locator('#amily2_mhb_large_editor').inputValue()));
    await go('floors');assert.equal(await p.locator('#amily2_auto_hide_threshold').inputValue(),'42');
    await go('automatic');assert.equal(await p.locator('#historiography_retention_count').inputValue(),'7');
    assert.equal(await p.locator('#am-large-auto-every').inputValue(),'3');
    await p.evaluate(async()=>{window.summaryCancelled=false;const ui=await import('/scripts/extensions/third-party/Memory/ui/page-window.js');ui.showSummaryModal('测试预览',{onCancel:()=>{window.summaryCancelled=true;}});});
    await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>window.summaryCancelled),true);
    await go('models');assert(await p.locator('.amily2_slot_select[data-slot="ragEmbed"]').isVisible());await p.locator('.amily2_slot_select[data-slot="ragEmbed"]').selectOption('embed-demo');
    await go('kb-knowledge-bases');
    const kb=p.locator('.hly-kb-list-item[data-kb-id="demo-chunks"]');await kb.waitFor();
    await kb.getByRole('button',{name:'查看分块'}).click();
    const viewer=p.getByRole('dialog',{name:'知识库分块'});await viewer.waitFor();
    await p.waitForFunction(()=>document.querySelector('.am-chunk-status')?.textContent.includes('全部 26 块'));
    assert.equal(await viewer.locator('.am-chunk-card').count(),12);
    await viewer.locator('.am-chunk-card summary').first().click();
    assert((await viewer.locator('.am-chunk-card pre').first().textContent()).includes('<img src=x'));
    assert.equal(await viewer.locator('img').count(),0);assert.equal(await p.evaluate(()=>window.chunkUnsafe),undefined);
    await viewer.getByRole('button',{name:'下一页'}).click();assert((await viewer.locator('.am-chunk-page').textContent()).startsWith('2 / 3'));
    await viewer.getByLabel('搜索分块').fill('第26块');assert.equal(await viewer.locator('.am-chunk-card').count(),1);
    await viewer.getByLabel('搜索分块').fill('找不到的内容');assert.equal(await viewer.locator('.am-chunk-card').count(),0);
    await viewer.getByLabel('搜索分块').fill('');
    assert((await viewer.locator('.am-chunk-status').textContent()).includes('25 份不同内容，1 条完全重复'));
    await viewer.getByLabel('只看完全重复的分块').check();assert.equal(await viewer.locator('.am-chunk-card').count(),2);
    assert.equal(await viewer.locator('.am-chunk-duplicate-note').count(),2);
    await p.screenshot({path:path.join(output,`duplicates-${width}.png`)});
    await viewer.getByLabel('只看完全重复的分块').uncheck();
    await p.screenshot({path:path.join(output,`chunks-${width}.png`)});
    await p.keyboard.press('Escape');await viewer.waitFor({state:'detached'});assert(await p.locator('#am-memory-app').isVisible());
    await kb.locator('.hly-kb-toggle').uncheck();
    assert.equal(await p.evaluate(async()=>{const core=await import('/scripts/extensions/third-party/Memory/core/rag-processor.js');return core.getLocalKnowledgeBases()['demo-chunks'].enabled;}),false);
    await kb.locator('.hly-kb-toggle').check();
    await p.route('**/api/vector/query',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({metadata:[{hash:1000,text:'部分读取的实际分块'}]})}),{times:1});
    await kb.getByRole('button',{name:'查看分块'}).click();
    await p.waitForFunction(()=>document.querySelector('.am-chunk-status')?.textContent.includes('1 / 26'));
    await p.keyboard.press('Escape');
    await go('kb-rerank');
    assert.equal(await p.locator('#hly-rerank-url').evaluate(n=>getComputedStyle(n).fontSize),'13px');
    await p.locator('.am-settings-fold').filter({has:p.locator('#hly-priority-retrieval-enabled')}).locator(':scope > summary').click();
    await p.locator('#hly-priority-retrieval-enabled').check();
    const sourceCount=p.locator('[data-setting-key="rerank.priorityRetrieval.sources.lorebook.count"]');
    await sourceCount.fill('3');await sourceCount.dispatchEvent('change');
    assert.equal(await p.evaluate(async()=>{const core=await import('/scripts/extensions/third-party/Memory/core/rag-processor.js');return core.getSettings().rerank.priorityRetrieval.sources.lorebook.count;}),3);
    await p.locator('#hly-priority-retrieval-enabled').evaluate(n=>{const block=n.closest('details');const content=document.querySelector('.am-work-content');content.scrollTop+=block.getBoundingClientRect().top-content.getBoundingClientRect().top;});
    await p.screenshot({path:path.join(output,`priority-sources-${width}.png`)});
    await go('connections');await p.locator('.amily2_profile_card').first().getByRole('button',{name:'编辑',exact:true}).click();
    await p.locator('#amily2_pf_name').fill('回读-'+width);await p.locator('#amily2_pf_fetch_models').click();await p.waitForFunction(()=>document.querySelector('#amily2_pf_model_list').children.length===2);
    await p.locator('#amily2_profile_modal_save').click();await p.locator('#amily2_profile_modal').waitFor({state:'hidden'});
    assert.equal(await p.locator('#amily2_profile_modal').evaluate(n=>getComputedStyle(n).fontFamily),await p.locator('body').evaluate(n=>getComputedStyle(n).fontFamily));
    await p.locator('.amily2_profile_card').first().getByRole('button',{name:'编辑',exact:true}).click();assert.equal(await p.locator('#amily2_pf_name').inputValue(),'回读-'+width);await p.keyboard.press('Escape');
    assert(await p.locator('#am-memory-app').isVisible());
    if(width<860)await p.locator('.am-menu-toggle').click();
    await p.getByLabel('界面主题').selectOption('st');await p.evaluate(()=>{document.body.style.setProperty('--SmartThemeBlurTintColor','#efe0cc');document.body.style.setProperty('--SmartThemeBodyColor','#35291f');document.body.style.setProperty('--SmartThemeQuoteColor','#486a82');});
    await p.waitForFunction(()=>getComputedStyle(document.querySelector('#amily2_chat_optimiser')).backgroundColor==='rgb(239, 224, 204)');
    async function buttonFollowsTheme() {
      return p.evaluate(()=>{
        const button=document.querySelector('#amily2_mhb_small_manual_execute');
        const probe=document.createElement('span');probe.style.color='var(--am-accent)';button.append(probe);
        const match=getComputedStyle(button).backgroundColor===getComputedStyle(probe).color;probe.remove();return match;
      });
    }
    assert(await buttonFollowsTheme());
    await p.evaluate(()=>document.body.style.setProperty('--SmartThemeQuoteColor','#755c89'));
    await p.waitForFunction(()=>getComputedStyle(document.querySelector('#amily2_mhb_small_manual_execute')).backgroundColor==='rgb(117, 92, 137)');
    await p.getByLabel('界面主题').selectOption('auto');await p.emulateMedia({colorScheme:'dark'});await p.waitForFunction(()=>document.querySelector('#amily2_chat_optimiser').dataset.memoryTheme==='night');
    assert(await buttonFollowsTheme());
    for(const theme of ['green','night','day']){await p.getByLabel('界面主题').selectOption(theme);assert(await buttonFollowsTheme());}
    await p.getByLabel('界面字号').selectOption('12');
    assert.equal(await p.evaluate(()=>localStorage.getItem('amily2_memory_font_size')),'12');
    assert.equal(await p.locator('.am-app-exit').evaluate(n=>getComputedStyle(n).fontSize),'12px');
    await p.getByLabel('界面字号').selectOption('15');
    assert.equal(await p.locator('.am-app-exit').evaluate(n=>getComputedStyle(n).fontSize),'15px');
    await p.getByLabel('界面字号').selectOption('13');
    if(width<860){await p.getByLabel('界面字号').focus();await p.keyboard.press('Tab');assert(await p.locator('.am-menu-close').evaluate(n=>n===document.activeElement));await p.keyboard.press('Shift+Tab');assert(await p.getByLabel('界面字号').evaluate(n=>n===document.activeElement));await p.keyboard.press('Escape');}
    await go('kb-historiography');
    assert.equal(await p.locator('[data-removed-feature="raw-chat-ingestion"]').isVisible(),false);
    assert.equal(await p.evaluate(async()=>{const m=await import('/scripts/extensions/third-party/Memory/core/rag-processor.js');const s=m.getSettings();s.condensation.enabled=true;s.condensation.autoCondense=true;const result=await m.processCondensation([{mes:'do not ingest'}]);return result.success;}),false);
    for(const folder of await p.locator('#hly-historiography-tab > .am-settings-fold').all())assert.equal(await folder.getAttribute('open'),null);
    await go('memory');
    await p.screenshot({path:path.join(output,`released-fullscreen-${width}.png`)});
    if(width<860){await p.locator('.am-menu-toggle').click();assert(await p.locator('.am-work-content').evaluate(n=>n.inert));await p.screenshot({path:path.join(output,`released-menu-${width}.png`)});await p.keyboard.press('Escape');assert.equal(await p.locator('.am-menu-toggle').getAttribute('aria-expanded'),'false');assert(await p.locator('#am-memory-app').isVisible());}
    else {await p.locator('.am-menu-toggle').click();assert.equal(await p.locator('.am-menu-toggle').getAttribute('aria-expanded'),'false');await p.locator('.am-menu-toggle').click();}
    // UI gating continues to follow original authorization status.
    await p.evaluate(async()=>{const prefix='/scripts/extensions/third-party/Memory/';const a=await import(prefix+'utils/auth.js');a.pluginAuthStatus.authorized=false;const state=await import(prefix+'ui/state.js');state.updateUI();});
    await p.locator('#auth_panel').waitFor();assert(await p.locator('#am-app-sidebar [data-route]').first().isDisabled());
    await p.evaluate(async()=>{const prefix='/scripts/extensions/third-party/Memory/';const a=await import(prefix+'utils/auth.js');a.pluginAuthStatus.authorized=true;const state=await import(prefix+'ui/state.js');state.updateUI();});
    await p.waitForFunction(()=>!document.querySelector('#amily2_chat_optimiser').classList.contains('am-auth-locked'));
    await p.locator('.am-app-exit').click();await p.locator('#am-memory-app').waitFor({state:'hidden'});await p.locator('#amily2_drawer_icon').focus();await p.keyboard.press('Enter');await p.locator('#am-memory-app').waitFor();
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,retained,routes:routes.length,settingsSaved:true,apiSaved:true,models:2,hostTheme:true,deviceTheme:true,authorization:true,keyboardReopen:true,errors}));
    await p.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
