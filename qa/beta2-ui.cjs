const {chromium}=require('../test/qa/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{
   const vault={ai:JSON.stringify({key:'mock-only',model:'mock',provider:'deepseek'})};let calls=0;
   window.Online={load:k=>vault[k]||'',store:(k,v)=>{vault[k]=v;return true;},scope:()=> 'guest',accountData:()=>'',request:(id,raw)=>{
    const req=JSON.parse(raw);window.lastRequest=req;calls++;window.aiCalls=calls;
    const answer=calls===1?{message:'建议',operations:[{type:'todo.create',value:{title:'喝牛奶'}}]}:{message:'请确认',operations:[{type:'todo.create',value:{title:'喝牛奶',dueAt:'2026-10-04T09:00:00+08:00'}}]};
    setTimeout(()=>onlineResult(id,200,JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}),true),10);
   }};
  });
  await page.goto('file:///C:/Users/15072/Desktop/TIM/app/src/main/assets/index.html');
  await page.click('#ai-fab');await page.check('#ai-context-todos');
  const before=await page.evaluate(()=>JSON.stringify(state));
  await page.fill('#ai-input','明天早上9点喝一杯牛奶，帮我添加待办');await page.click('#ai-send');
  await page.getByRole('button',{name:'预览 1 项修改'}).click();
  assert.equal(await page.evaluate(()=>aiCalls),2);
  assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
  await page.click('#ai-cancel');assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
  await page.getByRole('button',{name:'预览 1 项修改'}).click();await page.click('#ai-apply');
  const todos=await page.evaluate(()=>state.todos);assert.equal(todos.length,1);assert.equal(todos[0].title,'喝牛奶');assert.ok(todos[0].id);assert.equal(todos[0].dueAt,Date.parse('2026-10-04T09:00:00+08:00'));
  assert.equal(await page.evaluate(()=>lastRequest.body.response_format.type),'json_object');
  await page.screenshot({path:'test/qa/beta2-ai.png',fullPage:true});
  console.log('PASS: malformed proposal repaired once; cancel preserves data; confirmation saves generated ID and correct date');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
