const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const targets=await (await fetch('http://127.0.0.1:9223/json')).json();
  const target=targets.find(p=>p.url.includes('appassets'));assert.ok(target);
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let seq=0;
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data);if(pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const page={evaluate:async(fn,arg)=>{const r=await send('Runtime.evaluate',{expression:'('+fn.toString()+')('+JSON.stringify(arg)+')',awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;},waitForSelector:async selector=>{for(let i=0;i<30;i++){if(await page.evaluate(s=>!!document.querySelector(s),selector))return;await new Promise(r=>setTimeout(r,200));}throw Error('missing '+selector);},click:selector=>page.evaluate(s=>document.querySelector(s).click(),selector),locator:selector=>({isVisible:()=>page.evaluate(s=>!document.querySelector(s).hidden,selector)}),reload:async()=>{await send('Page.reload');await new Promise(r=>setTimeout(r,1200));},screenshot:async({path})=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path,Buffer.from(r.data,'base64'));}};
  await page.waitForSelector('#ai-fab');
  const original=await page.evaluate(()=>({data:JSON.stringify(state),scope:Online.scope(),cloud:Online.load('cloud')||'{}',ai:Online.load('ai')||'{}'}));
  try{
    const checks=await page.evaluate(async()=>{
      const config={provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',key:'qa-only-not-a-real-key'};
      if(!Online.store('ai',JSON.stringify(config)))throw Error('Keystore save failed');
      if(JSON.parse(Online.load('ai')).key!==config.key)throw Error('Keystore roundtrip failed');
      const raw=JSON.stringify(state),storedRaw=Android.loadData(),target='qa-isolated-account',doc=C.defaults();
      doc.todos=[{id:'qa-task',title:'仅测试账号',dueAt:1800000000000,createdAt:1700000000000,priority:'normal',note:'',completed:false,remind:false}];
      const oldScope=Online.scope(),oldCloud=Online.load('cloud')||'{}';
      if(!Online.activate(target,JSON.stringify(doc),'{}'))throw Error('activate failed');
      if(Online.accountData(oldScope)!==storedRaw)throw Error('old account not archived');
      if(JSON.parse(Android.loadData()).todos[0].title!=='仅测试账号')throw Error('account document missing');
      if(!Online.activate(oldScope,raw,oldCloud))throw Error('restore failed');
      const result=await new Promise(resolve=>{const prior=window.onlineResult;window.onlineResult=(id,status,body,json)=>{if(id==='native_qa'){window.onlineResult=prior;resolve({status,body});}else prior(id,status,body,json);};Online.store('cloud',JSON.stringify({baseUrl:'http://127.0.0.1'}));Online.request('native_qa',JSON.stringify({target:'cloud',path:'/api/v1/health',method:'GET'}));});
      if(result.status!==0)throw Error('HTTP unexpectedly allowed');Online.store('cloud',oldCloud);
      return ['native Keystore encrypt/decrypt','atomic account isolation/restore','HTTP rejected'];
    });
    const storedPrefs=require('node:child_process').execFileSync('test/toolchain/sdk/platform-tools/adb.exe',['shell','run-as','cn.xingke.timetable','cat','shared_prefs/star_schedule.xml'],{encoding:'utf8'});
    assert.ok(!storedPrefs.includes('qa-only-not-a-real-key'),'key must not be plaintext in preferences');
    if(process.env.TEST_PROVIDER_TLS==='1'){
      const tls=await page.evaluate(async()=>{
        const old=Online.load('cloud')||'{}',prior=window.onlineResult;
        try{
          Online.store('cloud',JSON.stringify({baseUrl:'https://api.deepseek.com'}));
          return await new Promise(resolve=>{const timer=setTimeout(()=>resolve({status:0,reason:'timeout'}),35000);window.onlineResult=(id,status,body,json)=>{if(id==='tls_qa'){clearTimeout(timer);resolve({status,reason:status===0?body:''});}else prior(id,status,body,json);};Online.request('tls_qa',JSON.stringify({target:'cloud',path:'/api/v1/health',method:'PATCH',body:{}}));});
        }finally{window.onlineResult=prior;Online.store('cloud',old);}
      });
      assert.ok(tls.status>0,'real provider HTTPS/PATCH transport: '+JSON.stringify(tls));console.log('PASS native TLS and PATCH; unauthenticated probe status '+tls.status);
    }
    await page.reload();await page.waitForSelector('#ai-fab');assert.equal(await page.evaluate(()=>JSON.parse(Online.load('ai')).key),'qa-only-not-a-real-key');
    await page.click('#ai-fab');assert.equal(await page.locator('#ai-panel').isVisible(),true);await page.screenshot({path:'test/qa/v200-native-ai.png'});await page.click('#ai-close');await page.click('#settings');await page.click('#account-settings');await page.screenshot({path:'test/qa/v200-native-login.png'});await page.click('#close');
    console.log('PASS Android: '+checks.join(', ')+', encrypted config survives WebView reload, AI and login views.');
  }finally{
    await page.evaluate(original=>{Online.store('ai',original.ai);Online.activate(original.scope,original.data,original.cloud);},original);
    await page.reload();socket.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
