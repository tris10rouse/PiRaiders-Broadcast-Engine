'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const {fixture}=require('../fixtures/game-day-spx.cjs');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.PIRAIDERS_BROWSER_EXECUTABLE?{executablePath:process.env.PIRAIDERS_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());
test('actual SPX Game Day page executes under CSP, reports real preparation failure and preserves native workspace',{timeout:45000},async t=>{
 const f=await fixture(t),context=await browser.newContext({viewport:{width:1440,height:1000}});t.after(()=>context.close());const page=await context.newPage(),errors=[],csp=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/violates.*Content Security Policy|Refused to.*(?:script|style)/i.test(message.text()))csp.push(message.text());});
 const response=await page.goto(f.origin+'/game-day');assert.equal(response.status(),200);await page.waitForFunction(()=>document.querySelector('#prepare')?.disabled===false);assert.equal(await page.locator('#event-select').inputValue(),'football');assert.equal(await page.locator('#event-select option:disabled').count(),1);
 await page.locator('#prepare').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Media preparation failed'));assert.equal(await page.locator('#candidate').isVisible(),false);assert.equal(f.child.pid,f.pid);assert.equal(f.child.exitCode,null);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 const artifacts=path.resolve(__dirname,'../../build/browser-artifacts');await fs.mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'actual-spx-game-day-preparation-failure.png'),fullPage:true});
 await page.locator('nav').getByRole('link',{name:'SPX Graphics',exact:true}).click();await page.waitForURL('**/shows');assert.equal(f.child.pid,f.pid);assert.equal(f.child.exitCode,null);assert.match(await page.locator('body').innerText(),/Bench|SPX/);
 await page.goto(f.origin+'/game-day');await page.waitForFunction(()=>document.querySelector('#prepare')?.disabled===false);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
});


test('actual SPX UI prepares/full-decodes and activates an event outside prewarm with a throwing native boundary',{timeout:45000},async t=>{
 const f=await fixture(t,{softwareSuccess:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});t.after(()=>context.close());const page=await context.newPage(),errors=[],csp=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/violates.*Content Security Policy|Refused to.*(?:script|style)/i.test(message.text()))csp.push(message.text());});
 await page.goto(f.origin+'/game-day');await page.waitForFunction(()=>document.querySelector('#prepare')?.disabled===false);await page.locator('#prepare').click();await page.locator('#candidate').waitFor({state:'visible'});assert.match(await page.locator('#candidate-name').innerText(),/Synthetic football/);assert.equal(await page.locator('#activate').isEnabled(),true);
 await page.locator('#activate').click();await page.waitForFunction(()=>document.querySelector('#active-name').textContent==='Synthetic football');await page.waitForFunction(()=>/1 slides? prepared/.test(document.querySelector('#slide-position').textContent));assert.match(await page.locator('#active-detail').innerText(),/outside the production window/);assert.equal(await page.locator('#launch').isDisabled(),true);assert.equal(f.child.pid,f.pid);assert.equal(f.child.exitCode,null);assert.equal(await fs.stat(f.nativeMarker).then(()=>true,()=>false),false);
 const artifacts=path.resolve(__dirname,'../../build/browser-artifacts');await fs.mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'actual-spx-game-day-prepared-waiting.png'),fullPage:true});
 await fs.writeFile(f.mediaFile,'corrupt source candidate');await page.locator('#prepare').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Media preparation failed'));assert.equal(await page.locator('#active-name').innerText(),'Synthetic football');assert.match(await page.locator('#slide-position').innerText(),/1 slides? prepared/);assert.equal(f.child.exitCode,null);assert.equal(await fs.stat(f.nativeMarker).then(()=>true,()=>false),false);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
});
