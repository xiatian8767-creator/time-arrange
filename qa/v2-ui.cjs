// Browser integration uses a simulated Android bridge and a real isolated API.
const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const base='http://127.0.0.1:18765',stamp=Date.now().toString(36);
async function req(route,body,token,method='POST'){
  const response=await fetch(base+'/api/v1'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.text()};
}
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let aiAnswer={message:'为你安排了报告',warnings:['请核对时间'],operations:[{type:'todo.create',id:'ai-todo',value:{title:'AI 报告',dueAt:1800000000000,createdAt:1700000000000,priority:'normal',note:'',completed:false,remind:true}}]};
  await page.exposeFunction('bridgeRequest',async raw=>{const r=JSON.parse(raw);if(r.target==='ai')return {status:200,body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(aiAnswer)}}]})};return req(r.path.replace('/api/v1',''),r.body,r.token,r.method);});
  await page.addInitScript(()=>{
    const get=k=>localStorage.getItem(k)||'';
    window.Online={load:n=>get('vault-'+n),store:(n,v)=>{localStorage.setItem('vault-'+n,v);return true;},scope:()=>get('scope')||'guest',accountData:s=>get('doc-'+s),activate:(s,d,c)=>{localStorage.setItem('doc-'+Online.scope(),get('data'));localStorage.setItem('part-'+Online.scope(),get('partner'));localStorage.setItem('scope',s);localStorage.setItem('data',d);localStorage.setItem('partner',get('part-'+s));localStorage.setItem('vault-cloud',c);return true;},request:(id,raw)=>bridgeRequest(raw).then(r=>window.onlineResult(id,r.status,r.body,true)),pickPhoto:()=>{}};
    window.Android={loadData:()=>get('data'),saveData:d=>{localStorage.setItem('data',d);return true;},loadPartner:()=>get('partner'),savePartner:p=>{localStorage.setItem('partner',p);return true;},notificationsEnabled:()=>true,exactRemindersEnabled:()=>true,exportBackup:raw=>window.lastExport=raw};
  });
  await page.goto('file:///'+path.resolve('app/src/main/assets/index.html').replaceAll('\\','/'));
  assert.equal(await page.locator('#schedule-toggle').isVisible(),false);
  await page.evaluate(()=>save({...state,todos:[{id:'guest',title:'访客秘密',dueAt:1800000000000,createdAt:1700000000000,priority:'normal',note:'',completed:false,remind:false}]}));
  await page.click('#settings');await page.click('#account-settings');await page.fill('#server-url','https://api.example.com');await page.fill('#login-name','ui'+stamp);await page.fill('#login-password','password-for-test');await page.fill('#login-nickname','测试同学');await page.click('#register-submit');await page.waitForSelector('#use-local');await page.click('#use-local');
  await page.waitForFunction(()=>JSON.parse(Online.load('cloud')).revision===1);
  let cloud=await page.evaluate(()=>JSON.parse(Online.load('cloud')));assert.equal((JSON.parse((await req('/me/data',null,cloud.accessToken,'GET')).body)).document.todos.length,1);
  // Another device changes the cloud; local changes must not be silently lost.
  let data=JSON.parse((await req('/me/data',null,cloud.accessToken,'GET')).body);
  data.document.todos[0].title='另一设备';await req('/me/data',{baseRevision:data.revision,document:data.document},cloud.accessToken,'PUT');
  await page.evaluate(()=>save({...state,todos:state.todos.map(t=>({...t,title:'本机修改'}))}));
  await page.click('#settings');await page.click('#account-settings');await page.click('#cloud-sync');await page.waitForSelector('#conflict-local');assert.equal(await page.evaluate(()=>state.todos[0].title),'本机修改');await page.click('#conflict-local');await page.waitForFunction(()=>JSON.parse(Online.load('cloud')).revision===3);
  // Real partner invitation/accept flow and no todo exposure.
  const b=JSON.parse((await req('/auth/register',{username:'mate'+stamp,password:'password-for-test',nickname:'测试搭子'})).body);
  const doc=await page.evaluate(()=>C.defaults());doc.courses=[{id:'mate-course',day:1,start:'s1',end:'s1',name:'搭子数学',room:'',note:'',color:'#6b9cf4'}];doc.todos=[{id:'private',title:'NEVER_EXPOSE',dueAt:1800000000000,createdAt:1700000000000,priority:'normal',note:'',completed:false,remind:false}];
  await req('/me/data',{baseRevision:0,document:doc},b.accessToken,'PUT');
  await page.evaluate(()=>window.openOnlinePartner());await page.fill('#lookup-id',b.user.userId);await page.click('#partner-search button');await page.click('#send-invite');await page.waitForSelector('#outgoing-list .invitation');
  const incoming=JSON.parse((await req('/partner',null,b.accessToken,'GET')).body).incoming;await req('/partner/invitations/'+incoming[0].id,{action:'accept'},b.accessToken,'PATCH');
  await page.evaluate(()=>window.openOnlinePartner());await page.waitForSelector('#online-unbind');await page.click('#close');await page.click('#schedule-partner');assert.equal(await page.locator('.page-actions').isVisible(),false);assert.equal(await page.evaluate(()=>JSON.stringify(partner).includes('NEVER_EXPOSE')),false);
  await page.screenshot({path:'test/qa/v200-partner.png'});
  await page.evaluate(()=>window.openOnlinePartner());await page.click('#online-unbind');await page.click('#unbind-confirm');await page.waitForSelector('#partner-search');await page.click('#close');assert.equal(await page.locator('#schedule-toggle').isVisible(),false);
  // AI generates proposal, cancel leaves document byte-for-byte intact, confirm applies.
  await page.evaluate(()=>Online.store('ai',JSON.stringify({provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',key:'mock-key'})));
  await page.click('#ai-fab');await page.check('#ai-context-todos');const before=await page.evaluate(()=>JSON.stringify(state));await page.fill('#ai-input','明天安排报告');await page.click('#ai-send');await page.locator('.ai-message button').click();await page.waitForSelector('#ai-apply');await page.screenshot({path:'test/qa/v200-ai-preview.png'});await page.click('#ai-cancel');assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
  await page.locator('.ai-message button').click();await page.click('#ai-apply');assert.equal(await page.evaluate(()=>state.todos.some(t=>t.id==='ai-todo')),true);
  await page.locator('.ai-message button').click();await page.click('#ai-apply');assert.equal(await page.evaluate(()=>state.todos.filter(t=>t.id==='ai-todo').length),1);await page.click('#close');
  await page.screenshot({path:'test/qa/v200-ai.png'});await page.click('#ai-close');
  // Drag persists and should not open chat; remains on-screen after resize.
  const fab=await page.locator('#ai-fab').boundingBox();await page.mouse.move(fab.x+25,fab.y+25);await page.mouse.down();await page.mouse.move(40,200,{steps:8});await page.mouse.up();assert.equal(await page.locator('#ai-panel').isVisible(),false);
  for(const width of [320,390,760]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:390,height:844});
  // Logout restores guest data; relogin retrieves account data, separate from guest.
  await page.waitForTimeout(2500);await page.click('#settings');await page.click('#account-settings');await page.screenshot({path:'test/qa/v200-account.png'});await page.click('#cloud-logout');await page.click('#logout-confirm');await page.waitForFunction(()=>Online.scope()==='guest');assert.equal(await page.evaluate(()=>state.todos[0].title),'访客秘密');assert.equal(await page.evaluate(()=>state.todos.length),1);
  await page.reload();assert.equal(await page.evaluate(()=>state.todos[0].title),'访客秘密');assert.equal(await page.locator('#schedule-toggle').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS: register/sync/conflict/partner privacy/unbind/AI preview+cancel+apply/stale proposal/drag/responsive/guest isolation.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
