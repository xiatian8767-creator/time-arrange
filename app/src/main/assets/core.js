(function(root){
 'use strict';
 const TIMES=[['08:00','08:40'],['08:50','09:30'],['10:10','10:50'],['11:00','11:40'],['11:50','12:20'],['14:00','14:40'],['14:50','15:30'],['16:00','16:40'],['16:50','17:35'],['17:45','18:30'],['20:30','21:20']];
 const BLUE='#6b9cf4',PINK='#eb91ad';
 function defaults(){return {version:1,slots:TIMES.map((t,i)=>({id:'s'+(i+1),start:t[0],end:t[1]})),courses:[
 [1,4,4,'904'],[1,8,8,'905'],[2,3,3,'904'],[2,6,6,'905'],[2,8,8,'904'],[3,1,1,'904'],[3,2,2,'905'],[3,5,5,'905'],[4,2,3,'905'],[4,6,6,'904'],[4,9,10,'905'],[5,1,1,'905'],[5,4,5,'904'],[5,9,10,'904']
 ].map((c,i)=>({id:'c'+i,day:c[0],start:'s'+c[1],end:'s'+c[2],name:c[3],room:'',note:'',color:c[3]==='904'?BLUE:PINK}))};}
 function minutes(t){if(typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw Error('请输入有效时间');return +t.slice(0,2)*60+(+t.slice(3));}
 function validate(data){
 if(!data||data.version!==1||!Array.isArray(data.slots)||!Array.isArray(data.courses))throw Error('不是有效的星课表备份');
 if(data.slots.length<1||data.slots.length>24||data.courses.length>400)throw Error('请保留 1–24 节时间，课程不超过 400 个');
 const ids=new Set();let last=-1;
 const slots=data.slots.map(s=>{if(!s||typeof s.id!=='string'||s.id.length>80||ids.has(s.id))throw Error('时间编号重复或无效');ids.add(s.id);const a=minutes(s.start),b=minutes(s.end);if(a>=b||a<last)throw Error('各节时间须从早到晚排列，且不能重叠');last=b;return {id:s.id,start:s.start,end:s.end};});
 const used=new Set();const courseIds=new Set();
 const courses=data.courses.map(c=>{if(!c||typeof c.id!=='string'||c.id.length>80||courseIds.has(c.id)||!Number.isInteger(c.day)||c.day<1||c.day>7)throw Error('课程编号或星期无效');courseIds.add(c.id);const a=slots.findIndex(s=>s.id===c.start),b=slots.findIndex(s=>s.id===c.end);if(a<0||b<a)throw Error('课程对应的节次无效');for(let i=a;i<=b;i++){const key=c.day+':'+i;if(used.has(key))throw Error('同一天的课程不能占用相同节次');used.add(key);}if(typeof c.name!=='string'||!c.name.trim()||c.name.length>30)throw Error('课程名称需要 1–30 个字');if(typeof c.color!=='string'||!/^#[0-9a-f]{6}$/i.test(c.color))throw Error('课程颜色无效');if(typeof c.room!=='string'||c.room.length>60||typeof c.note!=='string'||c.note.length>500)throw Error('地点或备注过长');return {id:c.id,day:c.day,start:c.start,end:c.end,name:c.name.trim(),color:c.color,room:c.room,note:c.note};});
 return {version:1,slots,courses};
 }
 function monday(date){const d=new Date(date);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
 function layout(slots,row=68,gap=14){let y=0;const rows=slots.map((s,i)=>{const r={top:y,height:row,start:minutes(s.start),end:minutes(s.end)};y+=row+(i<slots.length-1?gap:0);return r;});return {rows,height:y};}
 function position(min,rows){if(min<rows[0].start)return {y:0,label:'课前'};for(let i=0;i<rows.length;i++){const r=rows[i];if(min<=r.end)return {y:r.top+(min-r.start)/(r.end-r.start)*r.height,label:'第 '+(i+1)+' 节'};const next=rows[i+1];if(next&&min<next.start)return {y:r.top+r.height+(min-r.end)/(next.start-r.end)*(next.top-r.top-r.height),label:'课间'};}const last=rows[rows.length-1];return {y:last.top+last.height,label:'课后'};}
 function status(data,date){const day=(date.getDay()+6)%7+1,min=date.getHours()*60+date.getMinutes()+date.getSeconds()/60;const list=[];for(const c of data.courses.filter(c=>c.day===day)){const a=data.slots.findIndex(s=>s.id===c.start),b=data.slots.findIndex(s=>s.id===c.end);for(let i=a;i<=b;i++)list.push({c,a:minutes(data.slots[i].start),b:minutes(data.slots[i].end),slot:data.slots[i]});}list.sort((a,b)=>a.a-b.a);const active=list.find(x=>min>=x.a&&min<x.b);if(active)return {title:'正在上课 · '+active.c.name,detail:(active.c.room?active.c.room+' · ':'')+'距下课 '+Math.ceil(active.b-min)+' 分钟'};const next=list.find(x=>x.a>min);if(next)return {title:'下一节 · '+next.c.name,detail:next.slot.start+' 开始 · 还有 '+Math.ceil(next.a-min)+' 分钟'};return {title:list.length?'今天的课程已结束':'今天没有课程',detail:'留一点时间，给自己。'};}
 const api={defaults,minutes,validate,monday,layout,position,status};root.StarCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
