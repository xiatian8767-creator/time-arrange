// Run against the project Android emulator's debug WebView forwarded to 9223.
const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function pages(){return (await fetch('http://127.0.0.1:9223/json/list')).json();}
async function connect(page){
 const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 return {send,close:()=>ws.close(),eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}};
}
(async()=>{
 const host=await connect((await pages()).find(p=>p.url.includes('appassets')));let h5;
 try{
  await host.eval(`window.qaNavigated=false;var oldOpen=window.openSecuritySettings;window.openSecuritySettings=()=>{window.qaNavigated=true;oldOpen();};Online.showCampaign(JSON.stringify({id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',title:'不应显示的活动标题',url:'https://8.154.43.154:8443/updates/security/',width:88,height:78}));`);
  let target;for(let i=0;i<60;i++){target=(await pages()).find(p=>p.url.includes('/updates/security/'));if(target)break;await pause(250);}assert.ok(target);
  h5=await connect(target);let point;
  for(let i=0;i<60;i++){point=await h5.eval(`(()=>{const b=document.querySelector('.action');if(!b)return null;b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);if(point)break;await pause(250);}assert.ok(point);
  assert.equal(await h5.eval('typeof Online'),'undefined');
  const shot=await h5.send('Page.captureScreenshot',{format:'png'});require('node:fs').writeFileSync('test/qa/beta21/security-h5.png',Buffer.from(shot.data,'base64'));
  await h5.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await h5.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  let navigated=false;for(let i=0;i<40;i++){navigated=await host.eval('window.qaNavigated');if(navigated)break;await pause(250);}assert.equal(navigated,true);
  assert.equal(await host.eval(`!!document.querySelector('#login-name')`),true);
  console.log('PASS native H5 isolation, user click navigation and login guard');
 }finally{h5?.close();host.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
