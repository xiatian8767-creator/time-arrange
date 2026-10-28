const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict');

(async()=>{
  const url=process.argv[2]||'https://8.154.43.154:8443/updates/3.4beta.4/';
  const version=new URL(url).pathname.split('/').filter(Boolean).pop();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:720}});
    let downloads=0;
    page.on('download',()=>downloads++);
    const response=await page.goto(url);
    assert.equal(response.status(),200);
    assert.match(response.headers()['content-type'],/^text\/html/);
    assert.ok(!response.headers()['content-disposition']);
    await page.locator('h1').waitFor({state:'visible'});
    assert.ok((await page.locator('main').innerText()).includes(version));
    const apk=await page.locator('a.download').evaluate(a=>a.href);
    assert.ok(apk.endsWith('/downloads/StarOrbit-'+version+'.apk'));
    const binary=await page.request.head(apk);
    assert.equal(binary.status(),200);
    assert.match(binary.headers()['content-type'],/application\/vnd\.android\.package-archive/);
    await page.screenshot({path:'test/qa/promo-current.png',fullPage:true});
    const popup=await browser.newPage({viewport:{width:390,height:720}});
    popup.on('download',()=>downloads++);
    await popup.setContent('<iframe title="App 活动弹窗" style="width:340px;height:560px;border:0"></iframe>');
    await popup.locator('iframe').evaluate((el,src)=>el.src=src,url);
    await popup.frameLocator('iframe').locator('h1').waitFor({state:'visible'});
    assert.equal(downloads,0);
    console.log('PASS: HTML inline render, no automatic download, popup iframe render, APK link and MIME');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
