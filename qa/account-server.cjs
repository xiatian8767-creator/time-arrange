// Isolated bridge simulation: no real credentials or server writes.
const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../app/src/main/assets'),base='https://8.154.43.154';
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!f.startsWith(root+path.sep)||!fs.existsSync(f))return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(fs.readFileSync(f));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const mode of ['new','register','existing','foreign','failure']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({mode,base})=>{
   const old=mode==='foreign'?'https://old.example.com':base,user={userId:'qa-user',nickname:'测试用户'},hasSession=['existing','foreign'].includes(mode);
   const vault={cloud:hasSession?{baseUrl:old,user,accessToken:'fake-old-only',revision:0}:{}},scopes={};let active=hasSession?old+'#qa-user':'guest';window.qaRequests=[];window.qaMode=mode;
   window.Online={load:n=>JSON.stringify(vault[n]||{}),store:(n,v)=>{vault[n]=JSON.parse(v);return true;},scope:()=>active,accountData:n=>scopes[n]||'',activate:(n,d,c)=>{scopes[active]=JSON.stringify(state);active=n;vault.cloud=JSON.parse(c);return true;},request:(id,raw)=>{const r=JSON.parse(raw);window.qaRequests.push({...r,storedBase:vault.cloud.baseUrl});let status=200,data={};if(r.path.includes('/auth/login')||r.path.includes('/auth/register')){if(mode==='failure'){status=401;data={detail:'测试登录失败'};}else data={accessToken:'fake-new-only',refreshToken:'fake-refresh-only',expiresIn:900,user};}else if(r.path==='/api/v1/me/data')data=r.method==='PUT'?{revision:1}:{revision:0,document:null};else if(r.path==='/api/v1/partner')data={partner:null};setTimeout(()=>onlineResult(id,status,JSON.stringify(data),true),0);}};
   window.qaVault=vault;window.qaScope=()=>active;
  },{mode,base});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.click('#settings');await page.click('#account-settings');
  assert.equal(await page.locator('#server-url').count(),0);assert.doesNotMatch(await page.locator('#dialog-body').innerText(),/服务器地址|8\.154\.43\.154/);
  if(mode==='existing'){assert.equal(await page.locator('#cloud-sync').count(),1);assert.equal(await page.evaluate(()=>qaVault.cloud.accessToken),'fake-old-only');assert.equal(await page.evaluate(()=>qaScope()),base+'#qa-user');}
  else{
   if(mode==='foreign'){assert.equal(await page.evaluate(()=>qaScope()),'https://old.example.com#qa-user');assert.ok(await page.evaluate(()=>qaRequests.every(r=>r.token!=='fake-old-only')));}
   const before=await page.evaluate(()=>JSON.stringify(state));await page.fill('#login-name','qa_test');await page.fill('#login-password','fake-password-only');
   if(mode==='register'){await page.fill('#login-nickname','测试昵称');await page.click('#register-submit');}else await page.click('#login-submit');
   if(mode==='failure'){await page.waitForSelector('#login-error:not(:empty)');assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);assert.equal(await page.evaluate(()=>qaScope()),'guest');}
   else{await page.waitForSelector('#use-cloud');const request=await page.evaluate(()=>qaRequests.find(r=>r.path.includes('/auth/login')||r.path.includes('/auth/register')));assert.equal(request.storedBase,base);assert.equal(request.body.username,'qa_test');assert.equal(request.path,mode==='register'?'/api/v1/auth/register':'/api/v1/auth/login');await page.click('#use-cloud');assert.equal(await page.evaluate(()=>qaScope()),base+'#qa-user');await page.click('#settings');await page.click('#account-settings');assert.doesNotMatch(await page.locator('#dialog-body').innerText(),/8\.154\.43\.154|服务器地址/);}
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 const java=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/cn/xingke/timetable/OnlineBridge.java'),'utf8');assert.ok(java.includes('endpoint=CLOUD_BASE_URL+path;'));assert.ok(java.includes('CLOUD_BASE_URL.equals(cloud.optString("baseUrl"))'));assert.ok(java.includes('connection.setSSLSocketFactory(betaSocketFactory())'));assert.ok(java.includes('base.replaceAll("/+$","")+"/chat/completions"'));
 console.log('PASS: fixed server login/register, existing session preserved, foreign tokens discarded without data reset, failed login preserves guest, hidden address and independent AI HTTPS.');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
