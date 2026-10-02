(function(root){
  'use strict';
  const C=root.StarCore||(typeof require==='function'?require('./core.js'):null);
  const clone=x=>JSON.parse(JSON.stringify(x));
  function proposal(base,answer,permissions){
    if(!answer||typeof answer.message!=='string'||!Array.isArray(answer.operations)||answer.operations.length>100)throw Error('AI 返回格式无效，请重试');
    let next=clone(base);const changes=[];
    for(const op of answer.operations){
      if(!op||typeof op.type!=='string')throw Error('AI 操作无效');
      if(op.type==='schedule.replace'){
        if(!permissions.schedule)throw Error('未授权 AI 修改课表');
        const schedule=C.scheduleOnly({version:2,slots:op.slots,courses:op.courses});
        changes.push({type:'替换课表和作息',before:{slots:next.slots,courses:next.courses},after:schedule});
        next={...next,...schedule};continue;
      }
      const match=/^(course|todo)\.(create|update|delete)$/.exec(op.type);
      if(!match)throw Error('AI 请求了不允许的操作');
      const [,kind,action]=match,key=kind==='course'?'courses':'todos';
      if(!permissions[kind==='course'?'schedule':'todos'])throw Error('未授权 AI 修改这类数据');
      const id=op.id,items=next[key],index=items.findIndex(x=>x.id===id);
      if(typeof id!=='string'||!id||id.length>80)throw Error('AI 操作 ID 无效');
      if(action==='create'&&index!==-1)throw Error('新增 ID 已存在');
      if(action!=='create'&&index===-1)throw Error('要修改的记录不存在');
      const before=index<0?null:clone(items[index]);
      if(action==='delete')items.splice(index,1);
      else{
        if(!op.value||typeof op.value!=='object'||Array.isArray(op.value)||Object.keys(op.value).some(k=>['__proto__','constructor','prototype','id'].includes(k)))throw Error('AI 字段无效');
        const fields=kind==='course'?['day','start','end','name','color','room','note']:['title','dueAt','priority','note','completed','remind','createdAt'];
        if(Object.keys(op.value).some(k=>!fields.includes(k)))throw Error('AI 返回了未知字段');
        const value={...(before||{}),...op.value,id};
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
  const api={proposal,parse};root.StarAI=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
