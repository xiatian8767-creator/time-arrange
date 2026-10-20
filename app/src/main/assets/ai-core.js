(function(root){
  'use strict';
  const C=root.StarCore||(typeof require==='function'?require('./core.js'):null);
  const clone=x=>JSON.parse(JSON.stringify(x));
  let sequence=0;
  function newId(items){let id;do{id='ai_'+Date.now().toString(36)+'_'+(++sequence).toString(36)+'_'+Math.random().toString(36).slice(2,10);}while(items.some(x=>x.id===id));return id;}
  function proposal(base,answer,permissions){
    if(!answer||typeof answer.message!=='string'||!Array.isArray(answer.operations)||answer.operations.length>100)throw Error('AI 返回格式无效，请重试');
    let next=clone(base);const changes=[];
    for(const op of answer.operations){
      if(!op||typeof op.type!=='string')throw Error('AI 操作无效');
      if(op.type==='schedule.replace'||op.type==='slots.replace'){
        if(!permissions.schedule)throw Error('未授权 AI 修改课表');
        const payload=op.value||op;
        if(!Array.isArray(payload.slots))throw Error('作息修改需要完整 slots 数组');
        const courses=op.type==='slots.replace'?next.courses:payload.courses;
        if(!Array.isArray(courses))throw Error('整表替换需要完整 courses 数组；仅修改作息请用 slots.replace');
        const normalized=courses.map(c=>({...{color:'#6b9cf4',room:'',note:''},...c,id:c.id||newId(courses)}));
        const schedule=C.scheduleOnly({version:2,slots:payload.slots,courses:normalized});
        changes.push({type:'替换课表和作息',before:{slots:next.slots,courses:next.courses},after:schedule});
        next={...next,...schedule};continue;
      }
      const match=/^(course|todo)\.(create|update|delete)$/.exec(op.type);
      if(!match)throw Error('不支持 '+op.type+'；允许 schedule.replace、slots.replace、course.create/update/delete、todo.create/update/delete');
      const [,kind,action]=match,key=kind==='course'?'courses':'todos';
      if(!permissions[kind==='course'?'schedule':'todos'])throw Error('请先勾选“'+(kind==='course'?'我的课表和作息':'我的待办')+'”，再重新发送；本次未修改数据');
      const items=next[key],id=action==='create'?newId(items):op.id,index=items.findIndex(x=>x.id===id);
      if(typeof id!=='string'||!id||id.length>80)throw Error('AI 操作 ID 无效');
      if(action==='create'&&index!==-1)throw Error('新增 ID 已存在');
      if(action!=='create'&&index===-1)throw Error('要修改的记录不存在');
      const before=index<0?null:clone(items[index]);
      if(action==='delete')items.splice(index,1);
      else{
        if(!op.value||typeof op.value!=='object'||Array.isArray(op.value)||Object.keys(op.value).some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('AI 字段无效');
        const supplied={...op.value};
        if(action==='create')delete supplied.id;
        const fields=kind==='course'?['day','start','end','name','color','room','note']:['title','dueAt','priority','note','completed','remind','createdAt','alarmEnabled','alarmAt'];
        if(Object.keys(supplied).some(k=>!fields.includes(k)))throw Error('AI 返回了未知字段');
        const defaults=action==='create'?(kind==='course'?{color:'#6b9cf4',room:'',note:''}:{priority:'normal',note:'',completed:false,remind:false,createdAt:Date.now()}):{};
        if(kind==='todo'&&typeof supplied.dueAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(supplied.dueAt))supplied.dueAt=Date.parse(supplied.dueAt);
        if(kind==='todo'&&typeof supplied.alarmAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(supplied.alarmAt))supplied.alarmAt=Date.parse(supplied.alarmAt);
        if(kind==='todo'&&action==='update'&&'dueAt' in supplied&&before.alarmEnabled&&!('alarmAt' in supplied)&&!('alarmEnabled' in supplied)){
          supplied.alarmAt=supplied.dueAt-(before.dueAt-before.alarmAt);
        }
        const value={...defaults,...(before||{}),...supplied,id};
        if(action==='create')items.push(value);else items[index]=value;
      }
      changes.push({type:({create:'新增',update:'修改',delete:'删除'})[action]+(kind==='course'?'课程':'待办'),before,after:action==='delete'?null:clone(items.find(x=>x.id===id))});
    }
    next=C.validate(next);
    return {next,changes,message:answer.message,warnings:Array.isArray(answer.warnings)?answer.warnings.map(String).slice(0,30):[]};
  }
  function parse(text){
    if(typeof text!=='string'||text.length>1024*1024)throw Error('AI 回复过大或为空');
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  }
  function textOnly(content){return Array.isArray(content)?content.filter(p=>p.type==='text').map(p=>p.text).join('\n')+'\n[此前图片已省略；以已识别内容和当前用户要求为准]':content;}
  class Conversation{
    constructor(){this.clear();}
    clear(){this.turns=[];this.anchor=null;this.note='';this.id=Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');}
    remember(content,answer){
      const turn={user:{role:'user',content},assistant:{role:'assistant',content:answer}};
      if(Array.isArray(content)&&content.some(p=>p.type==='image_url'))this.anchor=turn;
      this.turns.push(turn);this.turns=this.turns.slice(-4);
    }
    messages(content){
      const hasImages=Array.isArray(content)&&content.some(p=>p.type==='image_url');
      const imageOwner=hasImages?content:this.anchor?.user.content;
      const turns=this.anchor&&!this.turns.includes(this.anchor)&&!hasImages?[this.anchor,...this.turns]:this.turns;
      return turns.flatMap(t=>[t.user,t.assistant]).map(m=>({role:m.role,content:Array.isArray(m.content)&&m.content!==imageOwner?textOnly(m.content):m.content}));
    }
    confirmed(){this.anchor=null;for(const t of this.turns)t.user.content=textOnly(t.user.content);this.note='之前预览的修改已由用户确认并保存。当前课表和待办是保存后的最新数据，未被再次要求时不要重复创建。';}
  }
  const api={proposal,parse,Conversation};root.StarAI=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
