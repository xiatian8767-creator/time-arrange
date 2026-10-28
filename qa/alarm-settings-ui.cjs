const {chromium}=require('../test/qa/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../app/src/main/assets');
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname,file=path.join(root,p==='/'?'index.html':p);if(!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html;charset=utf-8');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.qaStatus={notifications:false,channel:true,exact:false,fullscreen:false,volume:0,battery:false};window.qaOpened=[];window.Android={loadData:()=>'',requestTodoPermissions:()=>{},alarmStatus:()=>JSON.stringify(qaStatus),openAlarmSetting:k=>qaOpened.push(k)};
  const user={userId:'aaaaaaaaaaaa',nickname:'测试用户'},base='https://8.154.43.154',vault={cloud:{baseUrl:base,user,accessToken:'qa',refreshToken:'qa',revision:0}};
  window.Online={load:k=>JSON.stringify(vault[k]||{}),store:(k,v)=>{vault[k]=JSON.parse(v);return true;},scope:()=>base+'#'+user.userId,accountData:()=>'',request:(id,raw)=>{const r=JSON.parse(raw);let data={ok:true};if(r.path==='/api/v1/me/data')data={revision:0,document:null,security:{required:false}};if(r.path==='/api/v1/partner')data={partner:null};if(r.path.startsWith('/api/v1/campaigns'))data={campaign:null};if(r.path==='/api/v1/stars')data={user,partner:null,balance:0};setTimeout(()=>onlineResult(id,200,JSON.stringify(data),true),5);}};
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!window.authLocked);await page.evaluate(()=>{showPage('todos');checkAlarmReadiness();});await page.locator('#alarm-settings').waitFor();
 assert.equal(await page.locator('[data-alarm-setting]').count(),6);assert.match(await page.locator('#alarm-settings').innerText(),/当前为静音/);
 await page.locator('[data-alarm-setting="volume"]').click();assert.deepEqual(await page.evaluate(()=>qaOpened),['volume']);
 await page.screenshot({path:'test/qa/alarm-settings.png',fullPage:true});
 await page.evaluate(()=>{qaStatus={notifications:true,channel:true,exact:true,fullscreen:true,volume:5,battery:true};refreshAlarmSettings();});assert.equal(await page.locator('.alarm-attention').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS: alarm diagnostic statuses, zero-volume warning, setting action, resume refresh and mobile width');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
