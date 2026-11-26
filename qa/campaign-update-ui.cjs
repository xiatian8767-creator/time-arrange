const {chromium}=require('../test/qa/node_modules/playwright');
const {readFileSync}=require('node:fs');
const http=require('node:http');
const assert=require('node:assert/strict');

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost').pathname;
  const name=url==='/admin/'?'index.html':url==='/updates/release.css'?'campaign-update.css':url.split('/').pop();
  if(!/^[\w.-]+$/.test(name))return res.writeHead(404).end();
  try{
    const contents=readFileSync('backend/admin-web/'+name);
    res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');
    res.end(contents);
  }catch{res.writeHead(404).end();}
});

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1320,height:1150}});
    let payload;
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/admin/api/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname;
      let data={},status=200;
      if(path.endsWith('/session'))status=401;
      if(path.endsWith('/login'))data={csrf:'test'};
      if(path.endsWith('/users'))data={users:[],hasMore:false};
      if(path.endsWith('/campaigns')){
        if(request.method()==='POST')payload=request.postDataJSON();
        data={campaigns:payload?[{...payload,id:'123',revision:1}]:[]};
      }
      await route.fulfill({status,json:data});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
    await page.fill('#username','operator');await page.fill('#password','test-password');
    await page.click('#login-form button');await page.click('#campaigns-tab');
    await page.click('#campaign-new');await page.selectOption('#campaign-kind','update');
    await page.fill('#campaign-title','新版探索版');
    await page.fill('#update-url','https://downloads.example.com/StarOrbit-3.4beta.5.apk');
    await page.fill('#update-text','待办与闹钟更新');
    await page.selectOption('#update-font','serif');
    await page.locator('#update-size').scrollIntoViewIfNeeded();
    const handle=await page.locator('#update-size').boundingBox();
    await page.mouse.move(handle.x+8,handle.y+8);await page.mouse.down();
    await page.mouse.move(handle.x-12,handle.y-22,{steps:5});await page.mouse.up();
    const width=Number(await page.inputValue('#campaign-width'));
    assert.ok(width<88);
    await page.click('#update-draw');
    const copy=await page.locator('#update-copy').boundingBox();
    await page.mouse.move(copy.x+copy.width*.12,copy.y+copy.height*.55);await page.mouse.down();
    await page.mouse.move(copy.x+copy.width*.81,copy.y+copy.height*.77,{steps:5});await page.mouse.up();
    await page.fill('#update-text','透明玻璃导航');
    assert.ok(await page.locator('#campaign-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:'test/qa/34beta5-update-editor.png'});
    await page.click('#campaign-save');
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    assert.equal(payload.frequency,'always');
    assert.equal(payload.width,width);
    assert.equal(payload.update.targetCode,32);
    assert.equal(payload.update.boxes[2].text,'透明玻璃导航');
    assert.ok(payload.update.boxes[2].width>60);
    assert.equal(await page.inputValue('#campaign-kind'),'update');
    assert.equal(await page.locator('#update-copy .release-text').count(),3);
    assert.equal(await page.inputValue('#update-text'),'待办与闹钟更新');
    assert.deepEqual(errors,[]);
    console.log('PASS update editor: modal resize, draw text box, edit font, save and reopen');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
