// Local, debug-emulator-only helper. Never expose this port to a network.
(async()=>{
  const target=(await (await fetch('http://127.0.0.1:9223/json')).json()).find(t=>t.url.includes('appassets'));
  if(!target)throw Error('app WebView not found');
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  const result=await new Promise((resolve,reject)=>{socket.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id===1)r.error?reject(Error(JSON.stringify(r.error))):resolve(r.result);});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:process.argv[2],returnByValue:true,awaitPromise:true}}));});
  socket.close();if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));console.log(JSON.stringify(result.result.value));
})().catch(e=>{console.error(e);process.exitCode=1;});
