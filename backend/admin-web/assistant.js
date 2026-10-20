'use strict';
(()=>{
const $=id=>document.getElementById(id),pane=['apis','usage','rules'].find(x=>location.pathname.includes('/'+x+'/'))||'apis';
let csrf='',offset=0,entries=[],editing=null;
const numeric=['coinsPerYuan','calendarYear','maxTokens','maxCharge'],strings=['multiplier','peakHit','peakMiss','peakOutput','offHit','offMiss','offOutput','period'];
const note=text=>$('notice').textContent=text;
const stamp=value=>value?new Date(value).toLocaleString():'—';
function cell(tr,text){const td=document.createElement('td');td.textContent=text??'—';tr.append(td);return td;}
async function api(path,body,method){const response=await fetch('/admin/api/'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'操作失败');return data;}
function entryBody(row){return {name:row.name,provider:row.provider,region:row.region,model:row.model,enabled:row.enabled,supportsImages:row.supportsImages,timeoutSeconds:row.timeoutSeconds};}
function action(td,label,run,danger=false){const button=document.createElement('button');button.type='button';button.textContent=label;button.className=danger?'danger':'secondary';button.onclick=async()=>{button.disabled=true;try{await run();}catch(error){note(error.message);}finally{button.disabled=false;}};td.append(button);}
async function loadApis(){
 const data=await api('assistant/apis');entries=data.apis;$('api-rows').replaceChildren();
 for(const row of entries){const tr=document.createElement('tr');cell(tr,row.name);cell(tr,(row.provider==='qwen'?'Qwen':'DeepSeek')+' / '+(row.region==='intl'?'新加坡':'北京'));cell(tr,row.model);cell(tr,row.supportsImages?'支持':'—');
 const td=cell(tr,''),tag=document.createElement('span'),cool=row.cooldownUntil>Date.now();tag.className='pill'+(!row.enabled?' off':cool?' warn':'');tag.textContent=!row.enabled?'已停用':cool?'冷却中':'就绪';td.append(tag);
 if(cool){const info=document.createElement('small');info.textContent='恢复于 '+stamp(row.cooldownUntil);td.append(info);}
 if(row.lastError){const info=document.createElement('small');info.textContent=row.lastError;td.append(info);}
 cell(tr,row.successes+' / '+row.failures);cell(tr,stamp(row.lastUsed));const buttons=document.createElement('div');buttons.className='buttons';cell(tr,'').append(buttons);
 action(buttons,'编辑',()=>edit(row));
 action(buttons,row.enabled?'停用':'启用',async()=>{await api('assistant/apis/'+row.id,{...entryBody(row),enabled:!row.enabled});await loadApis();});
 if(cool||row.lastError)action(buttons,'解除冷却',async()=>{await api('assistant/apis/'+row.id+'/reset',{});await loadApis();});
 action(buttons,'删除',async()=>{if(!confirm('删除 API「'+row.name+'」？历史访问记录将保留。'))return;await api('assistant/apis/'+row.id,null,'DELETE');await loadApis();},true);
 $('api-rows').append(tr);
 }
 if(!entries.length){const tr=document.createElement('tr');const td=cell(tr,'尚未添加 API，点击右上方新增。');td.colSpan=8;$('api-rows').append(tr);}
 $('pool-summary').textContent='共 '+entries.length+' 个 API，'+entries.filter(x=>x.enabled).length+' 个已启用。所有 API 共用统一计费规则。';
}
function edit(row){
 editing=row?.id||null;$('api-form').reset();$('editor-error').textContent='';$('editor-title').textContent=editing?'编辑 API':'新增 API';
 $('api-name').value=row?.name||'';$('api-provider').value=row?.provider||'deepseek';$('api-region').value=row?.region||'cn';$('api-model').value=row?.model||'deepseek-flash';$('api-timeout').value=row?.timeoutSeconds||180;
 $('api-enabled').checked=row?row.enabled:true;$('api-vision').checked=row?row.supportsImages:true;$('api-key').value='';$('api-key').required=!editing;$('region-label').hidden=$('api-provider').value!=='qwen';$('api-editor').showModal();
}
$('add-api').onclick=()=>edit(null);$('close-editor').onclick=$('cancel-editor').onclick=()=>$('api-editor').close();
$('api-provider').onchange=()=>{$('region-label').hidden=$('api-provider').value!=='qwen';$('api-region').value='cn';$('api-model').value=$('api-provider').value==='qwen'?'qwen3-vl-plus':'deepseek-flash';$('api-vision').checked=true;};
$('api-form').onsubmit=async event=>{
 event.preventDefault();$('save-api').disabled=true;$('editor-error').textContent='';
 try{const body={name:$('api-name').value.trim(),provider:$('api-provider').value,region:$('api-region').value,model:$('api-model').value.trim(),apiKey:$('api-key').value.trim(),enabled:$('api-enabled').checked,supportsImages:$('api-vision').checked,timeoutSeconds:Number($('api-timeout').value)};
 await api('assistant/apis'+(editing?'/'+editing:''),body);$('api-key').value='';$('api-editor').close();await loadApis();note('API 已保存。');
 }catch(error){$('editor-error').textContent=error.message;}finally{$('save-api').disabled=false;}
};
$('refresh-apis').onclick=()=>loadApis().catch(error=>note(error.message));
async function loadRules(){const data=await api('assistant/rules');for(const id of [...numeric,...strings])$(id).value=data[id];$('enabled').checked=data.enabled;$('holidays').value=data.holidays.join('\n');}
$('config').onsubmit=async event=>{
 event.preventDefault();$('save').disabled=true;
 try{const body={enabled:$('enabled').checked,holidays:$('holidays').value.split(/\s+/).filter(Boolean)};for(const id of numeric)body[id]=Number($(id).value);for(const id of strings)body[id]=$(id).value;
 await api('assistant/rules',body);await loadRules();note('统一规则已保存，之后所有 API 都按这套规则计费。');
 }catch(error){note(error.message);}finally{$('save').disabled=false;}
};
$('reload').onclick=()=>loadRules().catch(error=>note(error.message));
function showAttempts(row){
 $('attempts-meta').textContent=stamp(row.createdAt)+' · '+(row.nickname||row.userId)+' · 结算 '+row.coins+' 星币';$('attempt-rows').replaceChildren();
 (row.attempts||[]).forEach((item,index)=>{const tr=document.createElement('tr');for(const value of [index+1,item.name+' / '+item.provider+' / '+item.model,item.success?'成功':('未完成'+(item.status?' / '+item.status:'')),(item.elapsedMs/1000).toFixed(2)+'秒',item.error||'—'])cell(tr,value);$('attempt-rows').append(tr);});
 if(!row.attempts?.length){const tr=document.createElement('tr');cell(tr,'无上游调用记录').colSpan=5;$('attempt-rows').append(tr);}
 $('attempts-dialog').showModal();
}
$('close-attempts').onclick=()=>$('attempts-dialog').close();
async function usage(){
 const data=await api('assistant/usage?offset='+offset+'&q='+encodeURIComponent($('usage-query').value.trim())+'&state='+encodeURIComponent($('usage-state').value));$('usage').replaceChildren();
 for(const row of data.calls){const tr=document.createElement('tr'),u=row.usage;cell(tr,stamp(row.createdAt));const user=cell(tr,row.nickname||row.userId),sub=document.createElement('small');sub.textContent=row.username+' · '+row.userId;user.append(sub);
 cell(tr,({done:'完成',pending:'处理中',failed:'失败 / 未扣费'})[row.state]||row.state);cell(tr,u?.apiName||'—');cell(tr,u?u.promptTokens+' / '+u.cachedTokens+' / '+u.outputTokens:'—');cell(tr,row.coins);const td=cell(tr,'');action(td,'查看路径'+(row.attempts?.length?'（'+row.attempts.length+'）':''),()=>showAttempts(row));$('usage').append(tr);}
 if(!data.calls.length){const tr=document.createElement('tr');cell(tr,'暂无匹配的访问记录').colSpan=7;$('usage').append(tr);}
 $('prev').disabled=offset===0;$('next').disabled=!data.hasMore;
}
$('usage-filter').onsubmit=event=>{event.preventDefault();offset=0;usage().catch(error=>note(error.message));};$('refresh').onclick=()=>usage().catch(error=>note(error.message));$('prev').onclick=()=>{offset=Math.max(0,offset-50);usage().catch(error=>note(error.message));};$('next').onclick=()=>{offset+=50;usage().catch(error=>note(error.message));};
api('session').then(async data=>{csrf=data.csrf;document.querySelector('[data-pane="'+pane+'"]').setAttribute('aria-current','page');$('heading').textContent=({apis:'星小助 API 列表',usage:'用户访问记录',rules:'统一计费规则'})[pane];$('workspace').hidden=false;$(pane+'-pane').hidden=false;await({apis:loadApis,usage,rules:loadRules})[pane]();note('');}).catch(error=>note(error.message+'，请返回工作台重新登录。'));
})();
