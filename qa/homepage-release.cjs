const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');

(async()=>{
  const [url,stable,explorer,stableHash,explorerHash]=process.argv.slice(2);
  assert.ok(url&&stable&&explorer&&stableHash&&explorerHash,'URL, stable/explorer versions and SHA256 required');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(url);
    assert.equal(response.status(),200);
    assert.match(response.headers()['cache-control'],/no-store/);
    await page.locator('#download').scrollIntoViewIfNeeded();
    const rows=page.locator('.download-row');assert.equal(await rows.count(),2);
    for(const [i,label,version,hash] of [[0,'稳定版',stable,stableHash],[1,'探索版',explorer,explorerHash]]){
      const row=rows.nth(i);
      assert.equal(await row.locator('h3').innerText(),label);
      assert.equal(await row.locator('.release').innerText(),version);
      const target=await row.locator('a').evaluate(a=>a.href);
      assert.equal(new URL(target).pathname,'/downloads/StarOrbit-'+version+'.apk');
      const apk=await page.request.get(target);
      assert.equal(apk.status(),200);
      assert.match(apk.headers()['content-type'],/application\/vnd\.android\.package-archive/);
      assert.equal(createHash('sha256').update(await apk.body()).digest('hex'),hash);
    }
    const feedback=await page.request.get(new URL('/feedback/',url).href,{maxRedirects:0});
    assert.equal(feedback.status(),302);
    assert.match(feedback.headers().location,/\/feedback\/$/);
    await page.locator('#download').screenshot({path:'test/qa/homepage-current-downloads.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: homepage queue versions, exactly two downloads, full APK SHA256, MIME, no-store and feedback redirect');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
