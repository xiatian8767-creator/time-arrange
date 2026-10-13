const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../app/src/main/assets/core.js'),AI=require('../app/src/main/assets/ai-core.js');
test('photo schedule replacement accepts missing optional course fields and preserves todos',()=>{
 const base=C.defaults();base.todos=[{id:'t1',title:'保留',dueAt:1000,priority:'normal',note:'',completed:false,remind:false}];
 const answer={message:'预览',operations:[{type:'schedule.replace',slots:[{id:'p1',start:'08:00',end:'08:45'}],courses:[{day:2,start:'p1',end:'p1',name:'数学'}]}]};
 const result=AI.proposal(base,answer,{schedule:true,todos:true});
 assert.equal(result.next.courses[0].name,'数学');assert.equal(result.next.todos[0].id,'t1');assert.equal(base.courses.length,0);
});
test('replace slots then add course as one confirmed transaction',()=>{
 const base=C.defaults();const result=AI.proposal(base,{message:'预览',operations:[{type:'slots.replace',slots:[{id:'s1',start:'08:00',end:'08:45'}]},{type:'course.create',value:{day:1,start:'s1',end:'s1',name:'数学'}}]},{schedule:true});
 assert.equal(result.next.courses.length,1);assert.equal(result.next.slots[0].end,'08:45');
 assert.throws(()=>AI.proposal(result.next,{message:'预览',operations:[{type:'slots.replace',slots:[{id:'other',start:'09:00',end:'09:45'}]}]},{schedule:true}),/节次/);
 assert.equal(result.next.slots[0].id,'s1');
});
