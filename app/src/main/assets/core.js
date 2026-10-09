(function(root){
  'use strict';

  const BLUE='#6b9cf4',PINK='#eb91ad';
  const DEFAULT_SLOTS=[
    {id:'s1',start:'08:00',end:'08:40'},
    {id:'s2',start:'08:50',end:'09:30'},
    {id:'recess',start:'09:30',end:'10:10',kind:'activity',label:'大课间'},
    {id:'s3',start:'10:10',end:'10:50'},
    {id:'s4',start:'11:00',end:'11:40'},
    {id:'s5',start:'11:50',end:'12:20'},
    {id:'lunch',start:'12:20',end:'14:00',kind:'activity',label:'午休'},
    {id:'s6',start:'14:00',end:'14:40'},
    {id:'s7',start:'14:50',end:'15:30'},
    {id:'s8',start:'16:00',end:'16:40'},
    {id:'s9',start:'16:50',end:'18:10'},
    {id:'dinner',start:'18:10',end:'18:40',kind:'activity',label:'晚餐'},
    {id:'s10',start:'18:40',end:'19:50'}
  ];

  function defaults(){
    return {version:2,slots:DEFAULT_SLOTS.map(s=>({...s})),courses:[],todos:[]};
  }

  // Remove only the untouched course set bundled before 1.2.5. Any personal edit keeps the data.
  function legacySampleCourses(){
    return [
      [1,4,4,'904'],[1,8,8,'905'],[2,3,3,'904'],[2,6,6,'905'],[2,8,8,'904'],
      [3,1,1,'904'],[3,2,2,'905'],[3,5,5,'905'],[4,2,3,'905'],[4,6,6,'904'],
      [4,9,10,'905'],[5,1,1,'905'],[5,4,5,'904'],[5,9,10,'904']
    ].map((c,i)=>({id:'c'+i,day:c[0],start:'s'+c[1],end:'s'+c[2],name:c[3],color:c[3]==='904'?BLUE:PINK,room:'',note:''}));
  }

  function minutes(t){
    if(typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw Error('请输入有效时间');
    return +t.slice(0,2)*60+(+t.slice(3));
  }

  function validate(data){
    if(!data||(data.version!==1&&data.version!==2)||!Array.isArray(data.slots)||!Array.isArray(data.courses))throw Error('不是有效的Star Orbit备份');
    if(data.version===2&&!Array.isArray(data.todos))throw Error('待办数据无效');
    if(data.slots.length<1||data.slots.length>24||data.courses.length>400)throw Error('请保留 1–24 个时间段，课程不超过 400 个');
    const ids=new Set();let last=-1;
    const slots=data.slots.map(s=>{
      if(!s||typeof s.id!=='string'||s.id.length>80||ids.has(s.id))throw Error('时间编号重复或无效');
      ids.add(s.id);const a=minutes(s.start),b=minutes(s.end);
      if(a>=b||a<last)throw Error('各时间段须从早到晚排列，且不能重叠');
      last=b;const slot={id:s.id,start:s.start,end:s.end};
      if(s.kind==='activity'){
        if(typeof s.label!=='string'||!s.label.trim()||s.label.length>12)throw Error('活动名称需要 1–12 个字');
        slot.kind='activity';slot.label=s.label.trim();
      }
      return slot;
    });
    if(!slots.some(s=>s.kind!=='activity'))throw Error('至少保留一节课程时间');

    const used=new Set(),courseIds=new Set();
    const courses=data.courses.map(c=>{
      if(!c||typeof c.id!=='string'||c.id.length>80||courseIds.has(c.id)||!Number.isInteger(c.day)||c.day<1||c.day>7)throw Error('课程编号或星期无效');
      courseIds.add(c.id);const a=slots.findIndex(s=>s.id===c.start),b=slots.findIndex(s=>s.id===c.end);
      if(a<0||b<a||slots[a].kind==='activity'||slots[b].kind==='activity')throw Error('课程对应的节次无效');
      for(let i=a;i<=b;i++)if(slots[i].kind!=='activity'){
        const key=c.day+':'+i;if(used.has(key))throw Error('同一天的课程不能占用相同节次');used.add(key);
      }
      if(typeof c.name!=='string'||!c.name.trim()||c.name.length>30)throw Error('课程名称需要 1–30 个字');
      if(typeof c.color!=='string'||!/^#[0-9a-f]{6}$/i.test(c.color))throw Error('课程颜色无效');
      if(typeof c.room!=='string'||c.room.length>60||typeof c.note!=='string'||c.note.length>500)throw Error('地点或备注过长');
      return {id:c.id,day:c.day,start:c.start,end:c.end,name:c.name.trim(),color:c.color,room:c.room,note:c.note};
    });

    const todoIds=new Set();
    const todos=(data.version===2?data.todos:[]).map(t=>{
      if(!t||typeof t.id!=='string'||!t.id||t.id.length>80||todoIds.has(t.id))throw Error('待办编号重复或无效');
      todoIds.add(t.id);
      if(typeof t.title!=='string'||!t.title.trim()||t.title.length>80)throw Error('待办标题需要 1–80 个字');
      if(!Number.isFinite(t.dueAt)||t.dueAt<0||t.dueAt>8640000000000000)throw Error('待办日期时间无效');
      if(!['low','normal','high'].includes(t.priority))throw Error('待办优先级无效');
      if(typeof t.note!=='string'||t.note.length>500)throw Error('待办备注过长');
      if(typeof t.completed!=='boolean'||typeof t.remind!=='boolean')throw Error('待办状态无效');
      const createdAt=Number.isFinite(t.createdAt)?t.createdAt:t.dueAt;
      const alarmEnabled=t.alarmEnabled===undefined?false:t.alarmEnabled,alarmAt=t.alarmAt===undefined?0:t.alarmAt;
      if(typeof alarmEnabled!=='boolean'||!Number.isSafeInteger(alarmAt)||alarmAt<0||alarmAt>8640000000000000||(alarmEnabled&&alarmAt===0))throw Error('闹钟时间无效');
      return {id:t.id,title:t.title.trim(),dueAt:t.dueAt,priority:t.priority,note:t.note,completed:t.completed,remind:t.remind,createdAt,alarmEnabled,alarmAt};
    });
    if(todos.length>500)throw Error('待办不能超过 500 个');
    return {version:2,slots,courses,todos};
  }

  // Upgrade only untouched legacy time tables; keep custom times and their course references.
  function upgrade(data){
    const clean=validate(data);
    const legacy=[['08:00','08:40'],['08:50','09:30'],['10:10','10:50'],['11:00','11:40'],['11:50','12:20'],['14:00','14:40'],['14:50','15:30'],['16:00','16:40'],['16:50','17:35'],['17:45','18:30'],['20:30','21:20']];
    const plain=legacy.map((t,i)=>({id:'s'+(i+1),start:t[0],end:t[1]}));
    const lunch=plain.map(s=>({...s}));lunch.splice(5,0,{id:'lunch',start:'12:20',end:'14:00',kind:'activity',label:'午休'});
    const unchanged=JSON.stringify(clean.slots)===JSON.stringify(plain)||JSON.stringify(clean.slots)===JSON.stringify(lunch);
    if(data.version===1&&unchanged&&!clean.courses.some(c=>c.start==='s11'||c.end==='s11'))clean.slots=defaults().slots;
    if(JSON.stringify(clean.courses)===JSON.stringify(legacySampleCourses()))clean.courses=[];
    return validate(clean);
  }
  function monday(date){const d=new Date(date);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
  function periodAt(min){return min<13*60?'上午':min<16*60+50?'下午':'晚上';}
  function layout(slots,row=72,gap=8){
    let y=0,lesson=0;
    const rows=slots.map((s,i)=>{
      if(s.kind!=='activity')lesson++;
      const height=s.kind==='activity'?42:row;
      const r={top:y,height,start:minutes(s.start),end:minutes(s.end),kind:s.kind||'lesson',label:s.label||'',lesson:s.kind==='activity'?null:lesson,period:periodAt(minutes(s.start))};
      y+=height+(i<slots.length-1?gap:0);return r;
    });
    return {rows,height:y};
  }
  function position(min,rows){
    if(min<rows[0].start)return {y:0,label:'课前'};
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(min<r.end||(min===r.end&&(!rows[i+1]||rows[i+1].start>min)))return {y:r.top+(min-r.start)/(r.end-r.start)*r.height,label:r.kind==='activity'?(r.label||'活动时间'):'第 '+r.lesson+' 节'};
      const next=rows[i+1];
      if(next&&min<next.start)return {y:r.top+r.height+(min-r.end)/(next.start-r.end)*(next.top-r.top-r.height),label:'课间'};
    }
    const last=rows[rows.length-1];return {y:last.top+last.height,label:'课后'};
  }
  function status(data,date){
    const day=(date.getDay()+6)%7+1,min=date.getHours()*60+date.getMinutes()+date.getSeconds()/60,list=[];
    for(const c of data.courses.filter(c=>c.day===day)){
      const a=data.slots.findIndex(s=>s.id===c.start),b=data.slots.findIndex(s=>s.id===c.end);
      for(let i=a;i<=b;i++)if(data.slots[i].kind!=='activity')list.push({c,a:minutes(data.slots[i].start),b:minutes(data.slots[i].end),slot:data.slots[i]});
    }
    list.sort((a,b)=>a.a-b.a);const active=list.find(x=>min>=x.a&&min<x.b);
    if(active)return {title:'正在上课 · '+active.c.name,detail:(active.c.room?active.c.room+' · ':'')+'距下课 '+Math.ceil(active.b-min)+' 分钟'};
    const next=list.find(x=>x.a>min);if(next)return {title:'下一节 · '+next.c.name,detail:next.slot.start+' 开始 · 还有 '+Math.ceil(next.a-min)+' 分钟'};
    return {title:list.length?'今天的课程已结束':'今天没有课程',detail:'留一点时间，给自己。'};
  }

  function scheduleOnly(data){
    if(!data||![1,2].includes(data.version))throw Error('不是有效的课表配置');
    const clean=validate({version:2,slots:data.slots,courses:data.courses,todos:[]});
    return {version:2,slots:clean.slots,courses:clean.courses};
  }
  const api={defaults,minutes,validate,upgrade,monday,layout,position,status,periodAt,scheduleOnly};
  root.StarCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
