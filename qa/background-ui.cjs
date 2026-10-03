const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto('file:///C:/Users/15072/Desktop/TIM/app/src/main/assets/index.html');
  const before=await page.evaluate(()=>JSON.stringify(state));
  await page.click('#settings');await page.click('#background-settings');
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'background.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="#a8c8e8"/><circle cx="200" cy="400" r="200" fill="#edb5d5"/></svg>')});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('star-schedule-background')||'{}').image);
  await page.locator('#background-transparency').fill('35');await page.locator('#background-transparency').dispatchEvent('change');
  assert.equal(await page.locator('.schedule-background').evaluate(e=>getComputedStyle(e).opacity),'0.65');
  await page.click('#close');await page.screenshot({path:'test/qa/beta3-background.png',fullPage:true});
  await page.reload();assert.equal(await page.locator('.schedule-background').evaluate(e=>getComputedStyle(e).opacity),'0.65');
  assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
  await page.click('#settings');await page.click('#background-settings');await page.click('#background-reset');
  assert.equal(await page.locator('.schedule-background').isVisible(),false);
  await page.reload();assert.equal(await page.locator('.schedule-background').isVisible(),false);
  console.log('PASS upload, opacity, reload persistence, reset persistence, schedule data unchanged');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
