const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../app/src/main/assets/core.js'),A=require('../app/src/main/assets/ai-core.js');
const todo={id:'t1',type:'todo.create',value:{title:'写报告',dueAt:1800000000000,createdAt:1700000000000,priority:'normal',note:'',completed:false,remind:true}};
test('proposals do not mutate base; confirmation caller owns persistence',()=>{const base=C.defaults(),raw=JSON.stringify(base);const r=A.proposal(base,{message:'建议',operations:[todo]}, {todos:true});assert.equal(JSON.stringify(base),raw);assert.equal(r.next.todos.length,1);assert.equal(r.changes[0].type,'新增待办');});
test('reject unapproved todo scope and arbitrary operations',()=>{assert.throws(()=>A.proposal(C.defaults(),{message:'',operations:[todo]},{schedule:true}));assert.throws(()=>A.proposal(C.defaults(),{message:'',operations:[{type:'eval',value:'alert(1)'}]},{}));});
test('invalid plan is atomic, unknown fields rejected',()=>{const base=C.defaults();assert.throws(()=>A.proposal(base,{message:'',operations:[todo,{type:'todo.delete',id:'no'}]},{todos:true}));assert.equal(base.todos.length,0);assert.throws(()=>A.proposal(base,{message:'',operations:[{...todo,value:{...todo.value,admin:true}}]},{todos:true}));});
test('schedule replacement preserves todos and validates overlap',()=>{let base=A.proposal(C.defaults(),{message:'',operations:[todo]},{todos:true}).next;const r=A.proposal(base,{message:'',warnings:['模糊文字'],operations:[{type:'schedule.replace',slots:[{id:'s1',start:'09:00',end:'09:45'}],courses:[]}]},{schedule:true});assert.deepEqual(r.next.todos,base.todos);assert.equal(r.warnings.length,1);});
test('parse JSON fenced output, no execution',()=>{assert.equal(A.parse('```json\n{"message":"好","operations":[]}\n```').message,'好');assert.throws(()=>A.parse('alert(1)'));});
test('create owns IDs, fills defaults and accepts explicit ISO date',()=>{
  const op={type:'todo.create',value:{id:123,title:'喝一杯牛奶',dueAt:'2026-10-04T09:00:00+08:00'}};
  const result=A.proposal(C.defaults(),{message:'预览',operations:[op,op]},{todos:true});
  assert.notEqual(result.next.todos[0].id,result.next.todos[1].id);
  assert.equal(result.next.todos[0].dueAt,Date.parse(op.value.dueAt));
  assert.equal(result.next.todos[0].remind,false);assert.equal(result.next.todos[0].priority,'normal');
});
test('update must target existing ID; missing deadline is not guessed',()=>{
  assert.throws(()=>A.proposal(C.defaults(),{message:'',operations:[{type:'todo.update',value:{title:'x'}}]},{todos:true}),/ID/);
  assert.throws(()=>A.proposal(C.defaults(),{message:'',operations:[{type:'todo.create',value:{title:'x'}}]},{todos:true}),/日期时间/);
});
