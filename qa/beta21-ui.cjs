// Isolated UI/bridge integration; only synthetic accounts, documents and photos.
const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const repo=path.resolve(__dirname,'..');fs.mkdirSync(path.join(repo,'test/qa/beta21'),{recursive:true});
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost').pathname;let file=url.startsWith('/admin/')?path.join(repo,'backend/admin-web',url.slice(7)||'index.html'):path.join(repo,'app/src/main/assets',url==='/'?'index.html':url);if(!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html;charset=utf-8');res.end(fs.readFileSync(file));});
async function bridge(page,mode){await page.addInitScript(({mode})=>{
 const base='https://8.154.43.154',user={userId:'aaaaaaaaaaaa',nickname:'测试用户'},existing=mode==='existing';
 const vault={cloud:existing?{baseUrl:base,user,accessToken:'mock-access',refreshToken:'mock-refresh',revision:0}: {},ai:{provider:'qwen',key:'mock-key',model:'qwen',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'}};
 let scope=existing?base+'#'+user.userId:'guest';window.qaRequests=[];window.qaVault=vault;window.qaCampaigns=[];
 window.Online={load:k=>JSON.stringify(vault[k]||{}),store:(k,v)=>{vault[k]=JSON.parse(v);return true;},scope:()=>scope,accountData:()=>'',activate:(s,d,c)=>{scope=s;vault.cloud=JSON.parse(c);return true;},pickPhoto:()=>{},showCampaign:raw=>{const c=JSON.parse(raw);qaCampaigns.push(c);setTimeout(()=>campaignResult(c.id,true),10);},request:(id,raw)=>{
  const r=JSON.parse(raw);qaRequests.push(r);let data={},status=200;
  if(r.target==='ai')data={choices:[{finish_reason:'stop',message:{content:JSON.stringify({message:'收到你的安排啦。',warnings:[],operations:[]})}}]};
  else if(r.path.includes('/auth/login')||r.path.includes('/auth/register'))data={user,accessToken:'mock-access',refreshToken:'mock-refresh',expiresIn:900};
  else if(r.path==='/api/v1/me/data')data=r.method==='PUT'?{revision:1}:{revision:0,document:null,security:{required:mode==='register'}};
  else if(r.path==='/api/v1/partner')data={partner:null};
  else if(r.path==='/api/v1/auth/recovery/questions')data={questions:['测试问题一','测试问题二']};
  else if(r.path==='/api/v1/campaigns')data={campaign:{id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',title:'测试活动',url:'https://example.com/',width:88,height:65},period:'once'};
  else data={ok:true};setTimeout(()=>onlineResult(id,status,JSON.stringify(data),true),10);
 }};
 },{mode});}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const mode of ['register','login','existing']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await bridge(page,mode);await page.goto(origin);await page.waitForTimeout(100);
  if(mode!=='existing'){
   assert.equal(await page.evaluate(()=>authLocked),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#modal').isVisible(),true);
   assert.equal(await page.locator('#close').isVisible(),false);assert.equal(await page.locator('main').isVisible(),false);
   await page.screenshot({path:'test/qa/beta21/login.png'});
   if(mode==='login'){
    await page.click('#forgot-password');await page.fill('#recovery-name','test_user');await page.click('#recovery-next');await page.fill('#recovery-answer0','answer one');await page.fill('#recovery-answer1','answer two');await page.fill('#recovery-password','new-password-123');await page.fill('#recovery-confirm','new-password-123');await page.click('#recovery-next');await page.waitForSelector('#login-name');
   }
   await page.fill('#login-name','test_user');await page.fill('#login-password','test-password-123');
   if(mode==='register'){await page.fill('#login-nickname','测试用户');await page.click('#register-submit');}else await page.click('#login-submit');
   await page.click('#use-local');
   if(mode==='register'){
    await page.waitForSelector('#security-form');assert.equal(await page.evaluate(()=>authLocked),true);await page.screenshot({path:'test/qa/beta21/security.png'});
    await page.fill('#security-password','test-password-123');
    await page.fill('#security-question1','我第一次旅行去哪里？');await page.fill('#security-answer1','青岛市');
    await page.locator('.security-suggestions summary').nth(1).click();await page.click('[data-field="2"][data-question="phrase"]');await page.fill('#security-answer2','星光下散步');
    assert.equal(await page.locator('#security-answer1').getAttribute('type'),'text');
    assert.equal(await page.locator('#security-form select').count(),0);
    await page.screenshot({path:'test/qa/beta21/security-custom.png'});
    await page.click('#security-form button[type="submit"], #security-form > button.primary');
   }
   await page.waitForFunction(()=>!window.authLocked);
  }
  assert.equal(await page.locator('main').isVisible(),true);
  if(mode==='existing'){
   await page.evaluate(()=>{save({...state,todos:[{id:'demo',title:'整理今天的笔记',dueAt:Date.now()+3600000,createdAt:Date.now(),priority:'normal',note:'',completed:false,remind:false,alarmEnabled:false,alarmAt:0}]});showPage('todos');});
   const gap=await page.evaluate(()=>document.querySelector('.reminder-actions').getBoundingClientRect().top-document.querySelector('#todo-list').getBoundingClientRect().bottom);assert.ok(gap>=20,'notification button spacing');
   await page.screenshot({path:'test/qa/beta21/todos.png'});await page.click('[data-toggle="demo"]');assert.ok(await page.locator('.todo-confetti').count()>0);assert.equal(await page.evaluate(()=>state.todos[0].completed),true);
   await page.click('#ai-fab');assert.equal(await page.locator('.ai-scopes').count(),0);
   const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
   await page.evaluate(p=>receiveAIPhoto(p),photo);assert.equal(await page.inputValue('#ai-input'),'');await page.click('#ai-send');await page.waitForFunction(()=>qaRequests.some(r=>r.target==='ai'));
   assert.equal(await page.locator('#ai-photo-preview').isVisible(),false);assert.equal(await page.locator('.ai-sent-photo').count(),1);
   await page.waitForFunction(()=>!document.querySelector('#ai-send').disabled);await page.fill('#ai-input','帮我看看今天的待办');await page.click('#ai-send');await page.waitForFunction(()=>!document.querySelector('#ai-send').disabled);
   const ai=await page.evaluate(()=>qaRequests.filter(r=>r.target==='ai'));assert.ok(Array.isArray(ai[0].body.messages.at(-1).content));assert.equal(typeof ai[1].body.messages.at(-1).content,'string');assert.ok(ai[1].body.messages[0].content.includes('整理今天的笔记'));
   await page.screenshot({path:'test/qa/beta21/chat.png'});await page.click('#ai-close');await page.waitForTimeout(3100);await page.evaluate(()=>appEntered());await page.waitForTimeout(200);const before=await page.evaluate(()=>qaCampaigns.length);await page.waitForTimeout(3100);await page.evaluate(()=>appEntered());await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>qaCampaigns.length),before);
  }
  assert.deepEqual(errors,[],mode);await page.close();
 }
 const admin=await browser.newPage({viewport:{width:1380,height:920}}),errors=[];admin.on('pageerror',e=>errors.push(e.message));let saved=[];
 await admin.route('**/admin/api/**',async route=>{const request=route.request(),url=new URL(request.url());let data={};if(url.pathname.endsWith('/session'))data={csrf:'mock',username:'operator'};else if(url.pathname.endsWith('/users'))data={users:[{userId:'aaaaaaaaaaaa',nickname:'测试用户',username:'test_user'}],hasMore:false};else if(url.pathname.endsWith('/campaigns')){if(request.method()==='POST'){saved.push(request.postDataJSON());data={id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',...saved.at(-1)};}else data={campaigns:saved.map((x,i)=>({id:String(i),...x}))};}await route.fulfill({json:data});});
 await admin.goto(origin+'/admin/');await admin.click('#campaigns-tab');await admin.click('#campaign-new');await admin.fill('#campaign-title','秋日更新');await admin.fill('#campaign-url','https://example.com/autumn');await admin.selectOption('#campaign-audience','custom');await admin.fill('#campaign-users','aaaaaaaaaaaa');await admin.selectOption('#campaign-frequency','weekly');await admin.screenshot({path:'test/qa/beta21/admin.png'});await admin.click('#campaign-save');await admin.waitForFunction(()=>!document.querySelector('#campaign-editor').open);assert.equal(saved[0].frequency,'weekly');assert.equal(saved[0].audience,'custom');assert.deepEqual(errors,[]);await admin.close();
 console.log('PASS: mandatory login, recovery, new-user questions, existing sessions, todo spacing/confetti, per-message photos/no autofill, full AI context, campaign receipt suppression, admin campaign editor.');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
