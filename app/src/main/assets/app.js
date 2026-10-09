'use strict';
const C=StarCore,$=id=>document.getElementById(id),DAYS=['一','二','三','四','五','六','日'],COLORS=['#6b9cf4','#eb91ad','#83bba6','#a391d7','#e8b16b','#7dbacb'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
let partner=null,viewPartner=false;
try{const raw=window.Android?Android.loadPartner():localStorage.getItem('star-partner');if(raw)partner=C.scheduleOnly(JSON.parse(raw));}catch(e){/* Preserve unreadable partner data until explicitly replaced. */}
const displayedSchedule=()=>viewPartner&&partner?partner:state;
let state,weekOffset=0,currentLayout,lastDate='',timer,returnFocus=null,loadingError=false,activePage='schedule',todoFilter='pending';

try{const raw=window.Android?Android.loadData():localStorage.getItem('star-schedule');state=raw?C.upgrade(JSON.parse(raw)):C.defaults();if(raw&&raw!==JSON.stringify(state)){if(window.Android){if(!Android.saveData(JSON.stringify(state)))throw Error('保存失败');}else localStorage.setItem('star-schedule',JSON.stringify(state));}}catch(e){state=C.defaults();loadingError=true;}

function save(next){
  const clean=C.validate(next),raw=JSON.stringify(clean);
  if(new TextEncoder().encode(raw).length>1024*1024)throw Error('数据超过 1 MB，请先备份并清理不需要的内容');
  if(window.Android){if(!Android.saveData(raw))throw Error('保存失败，请检查手机存储空间');}else localStorage.setItem('star-schedule',raw);
  state=clean;render();window.dispatchEvent(new Event('star-data-changed'));
}
function notify(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('toast').hidden=true,3000);}
window.nativeNotice=notify;
function closeModal(){if($('modal').hidden)return false;$('modal').hidden=true;document.body.style.overflow='';if(returnFocus&&returnFocus.isConnected)returnFocus.focus();return true;}
function showPage(name){activePage=name==='todos'?'todos':'schedule';$('schedule-page').hidden=activePage!=='schedule';$('todo-page').hidden=activePage!=='todos';['schedule','todos'].forEach(page=>{const button=$('nav-'+page);button.classList.toggle('selected',page===activePage);if(page===activePage)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});if(activePage==='todos')renderTodos();else tick();window.scrollTo(0,0);}
window.showPage=showPage;
window.handleBack=()=>{if(closeModal())return true;if(activePage==='todos'){showPage('schedule');return true;}return false;};
function showModal(title,html){returnFocus=document.activeElement;$('dialog-title').textContent=title;$('dialog-body').innerHTML=html;$('modal').hidden=false;document.body.style.overflow='hidden';$('close').focus();}
$('close').onclick=closeModal;$('modal').onclick=e=>{if(e.target===$('modal'))closeModal();};
document.addEventListener('keydown',e=>{if($('modal').hidden)return;if(e.key==='Escape')closeModal();if(e.key==='Tab'){const els=[...$('modal').querySelectorAll('button,input,select,textarea')].filter(el=>!el.disabled&&el.offsetParent!==null);if(!els.length)return;if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els[els.length-1].focus();}else if(!e.shiftKey&&document.activeElement===els[els.length-1]){e.preventDefault();els[0].focus();}}});

const dateKey=d=>d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate();
function courseSegments(a,b){const state=displayedSchedule();const result=[];let start=null;for(let i=a;i<=b;i++){if(state.slots[i].kind==='activity'){if(start!==null){result.push([start,i-1]);start=null;}}else if(start===null)start=i;}if(start!==null)result.push([start,b]);return result;}
function renderSchedule(){
  const state=displayedSchedule();
  $('schedule-toggle').hidden=!partner;
  $('schedule-toggle').style.setProperty('--progress',viewPartner?1:0);
  ['schedule-mine','schedule-partner'].forEach((id,i)=>{const selected=Boolean(i)===viewPartner;$(id).classList.toggle('selected',selected);$(id).setAttribute('aria-pressed',String(selected));});
  document.querySelector('.page-actions').hidden=viewPartner;
  $('add').hidden=viewPartner;$('times').hidden=viewPartner;
  document.querySelector('.legend').hidden=viewPartner;
  const now=new Date(),monday=C.monday(now);monday.setDate(monday.getDate()+weekOffset*7);const sunday=new Date(monday);sunday.setDate(sunday.getDate()+6);
  $('week-title').textContent=(monday.getMonth()+1)+'月'+monday.getDate()+'日 — '+(sunday.getMonth()+1)+'月'+sunday.getDate()+'日';
  $('week-subtitle').textContent=monday.getFullYear()+' · '+(weekOffset===0?'本周':weekOffset===-1?'上周':weekOffset===1?'下周':'每周重复课表');
  $('week-head').innerHTML='<div class="axis-caption">时段<br>节次</div>'+DAYS.map((d,i)=>{const date=new Date(monday);date.setDate(date.getDate()+i);return '<div class="day-head '+(dateKey(date)===dateKey(now)?'current':'')+'">'+d+'<strong>'+date.getDate()+'</strong></div>';}).join('');
  currentLayout=C.layout(state.slots);const {rows,height}=currentLayout;$('schedule').style.height=height+'px';$('grid').style.height=height+'px';
  let previousPeriod='';
  $('time-axis').innerHTML=state.slots.map((s,i)=>{const r=rows[i],showPeriod=r.kind!=='activity'&&r.period!==previousPeriod;if(r.kind!=='activity')previousPeriod=r.period;return '<div class="time-item '+(r.kind==='activity'?'activity-time':'')+'" style="top:'+r.top+'px;height:'+r.height+'px">'+(showPeriod?'<span class="period-name">'+r.period+'</span>':'')+'<strong>'+esc(r.kind==='activity'?(r.label||'活动'):r.lesson)+'</strong><small>'+s.start+'–'+s.end+'</small></div>';}).join('');
  let html=rows.map(r=>r.kind==='activity'?'<div class="activity-row" style="top:'+r.top+'px;height:'+r.height+'px" aria-label="'+esc(r.label||'活动时间')+'"></div>':'').join('');
  for(let day=1;day<=7;day++){
    html+='<div class="day-column '+(weekOffset===0&&day===(now.getDay()+6)%7+1?'is-today':'')+'" style="left:'+((day-1)*100/7)+'%;width:'+(100/7)+'%"></div>';
    rows.forEach((r,i)=>{if(r.kind!=='activity'&&!viewPartner)html+='<button class="empty-cell" data-day="'+day+'" data-slot="'+i+'" style="left:'+((day-1)*100/7)+'%;width:'+(100/7)+'%;top:'+r.top+'px;height:'+r.height+'px" aria-label="添加周'+DAYS[day-1]+'第'+r.lesson+'节课程"></button>';});
  }
  for(const c of state.courses){
    const a=state.slots.findIndex(s=>s.id===c.start),b=state.slots.findIndex(s=>s.id===c.end),segments=courseSegments(a,b);
    segments.forEach((segment,index)=>{const first=rows[segment[0]],last=rows[segment[1]];html+='<button class="course '+(index?'continuation':'')+'" data-id="'+esc(c.id)+'" style="left:calc('+((c.day-1)*100/7)+'% + 2px);width:calc('+(100/7)+'% - 4px);top:'+first.top+'px;height:'+(last.top+last.height-first.top)+'px;background:'+c.color+'" aria-label="'+esc((viewPartner?'查看 ':'编辑 ')+c.name+' 周'+DAYS[c.day-1]+' 第'+first.lesson+'至'+last.lesson+'节')+'"><strong>'+esc(c.name)+'</strong>'+(c.room?'<small>'+esc(c.room)+'</small>':'')+'</button>';});
  }
  $('grid').innerHTML=html;document.querySelectorAll('.now-line').forEach(el=>el.remove());const line=document.createElement('div');line.className='now-line';line.innerHTML='<span class="time-label"></span><span class="time-star">★</span>';$('schedule').appendChild(line);lastDate=dateKey(now);tick();
}
function render(){renderSchedule();renderTodos();}
function tick(){const now=new Date();if(lastDate!==dateKey(now)){renderSchedule();return;}const stat=C.status(displayedSchedule(),now);$('now-label').textContent=stat.title;$('now-detail').textContent=stat.detail;const line=document.querySelector('.now-line');if(!line)return;line.hidden=weekOffset!==0;if(weekOffset!==0)return;const min=now.getHours()*60+now.getMinutes()+now.getSeconds()/60,pos=C.position(min,currentLayout.rows);line.style.top=pos.y+'px';line.querySelector('.time-star').style.left=(((now.getDay()+6)%7+.5)*100/7)+'%';const hh=String(now.getHours()).padStart(2,'0'),mm=String(now.getMinutes()).padStart(2,'0');line.querySelector('.time-label').textContent=hh+':'+mm;line.setAttribute('aria-label','现在 '+hh+':'+mm+' '+pos.label);}

$('grid').onclick=e=>{if(viewPartner){const card=e.target.closest('.course');if(card){const c=partner.courses.find(x=>x.id===card.dataset.id);showModal(c.name,'<p class="hint">搭子课表 · 只读</p><p>'+esc(c.room||'未填写地点')+'</p><p class="partner-note">'+esc(c.note||'无备注')+'</p>');}return;}const card=e.target.closest('.course');if(card){editCourse(card.dataset.id);return;}const cell=e.target.closest('.empty-cell');if(cell)editCourse(null,+cell.dataset.day,+cell.dataset.slot);};
$('prev').onclick=()=>{weekOffset--;renderSchedule();};$('next').onclick=()=>{weekOffset++;renderSchedule();};$('today').onclick=()=>{weekOffset=0;renderSchedule();setTimeout(()=>{const line=document.querySelector('.now-line');if(line)line.scrollIntoView({behavior:'smooth',block:'center'});},30);};
$('add').onclick=()=>editCourse();$('times').onclick=editTimes;$('settings').onclick=settings;$('nav-schedule').onclick=()=>showPage('schedule');$('nav-todos').onclick=()=>showPage('todos');

function editCourse(id=null,day=(new Date().getDay()+6)%7+1,slot=0){
  const old=state.courses.find(c=>c.id===id),firstLesson=state.slots.findIndex(s=>s.kind!=='activity');if(!old&&state.slots[slot].kind==='activity')slot=firstLesson;
  const c=old||{id:uid(),name:'',day,start:state.slots[slot].id,end:state.slots[slot].id,color:COLORS[0],room:'',note:''};let color=c.color;
  const opts=sel=>{let lesson=0;return state.slots.map(s=>{if(s.kind==='activity')return '';lesson++;return '<option value="'+esc(s.id)+'" '+(s.id===sel?'selected':'')+'>第 '+lesson+' 节 · '+s.start+'</option>';}).join('');};
  showModal(old?'编辑课程':'添加课程','<form id="course-form"><label>课程名称<input id="course-name" maxlength="30" required placeholder="例如：高等数学" value="'+esc(c.name)+'"></label><div class="form-row"><label>星期<select id="course-day">'+DAYS.map((d,i)=>'<option value="'+(i+1)+'" '+(c.day===i+1?'selected':'')+'>星期'+d+'</option>').join('')+'</select></label><label>地点（选填）<input id="course-room" maxlength="60" placeholder="教室或线上" value="'+esc(c.room)+'"></label></div><div class="form-row"><label>开始节次<select id="course-start">'+opts(c.start)+'</select></label><label>结束节次<select id="course-end">'+opts(c.end)+'</select></label></div><label>卡片颜色</label><div class="colors">'+COLORS.map(x=>'<button type="button" class="swatch '+(x===color?'selected':'')+'" style="background:'+x+'" data-color="'+x+'" aria-label="选择颜色 '+x+'" aria-pressed="'+(x===color)+'"></button>').join('')+'</div><label style="margin-top:17px">备注（选填）<textarea id="course-note" maxlength="500" placeholder="老师、上课提醒……">'+esc(c.note)+'</textarea></label><div class="hint">课程每周重复；跨越大课间、午休或晚餐时会分段显示。</div><div id="form-error" class="error" role="alert"></div><div class="actions">'+(old?'<button type="button" class="danger" id="delete-course">删除</button>':'')+'<button class="primary" type="submit">保存课程</button></div></form>');
  document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{color=b.dataset.color;document.querySelectorAll('.swatch').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',x===b);});});
  $('course-start').onchange=()=>{if($('course-end').selectedIndex<$('course-start').selectedIndex)$('course-end').selectedIndex=$('course-start').selectedIndex;};
  $('course-form').onsubmit=e=>{e.preventDefault();try{save({...state,courses:state.courses.filter(x=>x.id!==c.id).concat({...c,name:$('course-name').value.trim(),room:$('course-room').value.trim(),note:$('course-note').value.trim(),day:+$('course-day').value,start:$('course-start').value,end:$('course-end').value,color})});closeModal();notify('课程已保存');}catch(err){$('form-error').textContent=err.message;}};
  if(old)$('delete-course').onclick=()=>confirmAction('删除这门课程？','将删除周'+DAYS[c.day-1]+'的「'+c.name+'」。',()=>{save({...state,courses:state.courses.filter(x=>x.id!==c.id)});notify('课程已删除');});
}
function confirmAction(title,message,action){showModal(title,'<p class="confirm-preview">'+esc(message)+'</p><div id="confirm-error" class="error" role="alert"></div><div class="actions"><button class="secondary" id="cancel-action">取消</button><button class="primary" id="confirm-action">确认</button></div>');$('cancel-action').onclick=closeModal;$('confirm-action').onclick=()=>{try{action();closeModal();}catch(e){$('confirm-error').textContent=e.message;}};}

function editTimes(){
  let draft=state.slots.map(s=>({...s}));
  showModal('作息时间','<p class="hint">可修改课程和活动时间。时间段须按顺序排列且不重叠，最多 24 个。</p><div id="time-rows"></div><button class="secondary" id="add-slot" style="margin-top:13px">＋ 增加一节</button><p class="hint">默认作息来自参考表：第 1–10 节，并包含大课间、午休和晚餐。</p><div id="time-error" class="error" role="alert"></div><div class="actions"><button class="primary" id="save-times">保存作息时间</button></div>');
  const rows=()=>{let lesson=0;$('time-rows').innerHTML=draft.map((s,i)=>{const name=s.kind==='activity'?(s.label||'活动'):'第 '+(++lesson)+' 节';return '<div class="time-edit-row"><span>'+esc(name)+'</span><input type="time" aria-label="'+esc(name)+'开始时间" data-index="'+i+'" data-field="start" value="'+s.start+'" required><span style="width:auto">—</span><input type="time" aria-label="'+esc(name)+'结束时间" data-index="'+i+'" data-field="end" value="'+s.end+'" required><button data-delete="'+i+'" aria-label="删除'+esc(name)+'">×</button></div>';}).join('');$('add-slot').disabled=draft.length>=24;};rows();
  $('time-rows').oninput=e=>{if(e.target.dataset.field)draft[+e.target.dataset.index][e.target.dataset.field]=e.target.value;};
  $('time-rows').onclick=e=>{const i=e.target.dataset.delete;if(i===undefined)return;const index=+i,id=draft[index].id;const used=state.courses.some(c=>{const a=state.slots.findIndex(s=>s.id===c.start),b=state.slots.findIndex(s=>s.id===c.end),target=state.slots.findIndex(s=>s.id===id);return target>=a&&target<=b;});if(used){$('time-error').textContent='这一时间段关联了课程，请先修改或删除对应课程。';return;}if(draft.filter(s=>s.kind!=='activity').length===1&&draft[index].kind!=='activity'){$('time-error').textContent='至少保留一节课程时间。';return;}draft.splice(index,1);$('time-error').textContent='';rows();};
  $('add-slot').onclick=()=>{if(draft.length>=24)return;let end;try{end=C.minutes(draft[draft.length-1].end);}catch(e){$('time-error').textContent='请先填写上一时间段的有效时间';return;}if(end+50>1439){$('time-error').textContent='当天时间不足，请先调整最后一节。';return;}const fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');draft.push({id:'s'+uid(),start:fmt(end+10),end:fmt(end+50)});rows();};
  $('save-times').onclick=()=>{try{save({...state,slots:draft});closeModal();notify('作息时间已更新');}catch(e){$('time-error').textContent=e.message;}};
}

function startOfDay(time){const d=new Date(time);d.setHours(0,0,0,0);return d.getTime();}
function todoDateLabel(time){const d=new Date(time),today=startOfDay(Date.now()),day=startOfDay(time),hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');if(day===today)return '今天 '+hm;if(day===today+86400000)return '明天 '+hm;return (d.getMonth()+1)+'月'+d.getDate()+'日 '+hm;}
function renderTodos(){
  const now=Date.now(),today=startOfDay(now),tomorrow=new Date(new Date(now).getFullYear(),new Date(now).getMonth(),new Date(now).getDate()+1).getTime(),pending=state.todos.filter(t=>!t.completed),done=state.todos.filter(t=>t.completed),todayItems=pending.filter(t=>t.dueAt>=today&&t.dueAt<tomorrow);
  $('todo-pending-count').textContent=pending.length;$('todo-today-count').textContent=todayItems.length;$('todo-done-count').textContent=done.length;$('todo-subtitle').textContent=pending.length?pending.length+' 项待办等你安排':'目前没有未完成事项';
  let list=state.todos.filter(t=>todoFilter==='all'||(todoFilter==='pending'&&!t.completed)||(todoFilter==='completed'&&t.completed)||(todoFilter==='today'&&!t.completed&&t.dueAt>=today&&t.dueAt<tomorrow));
  list.sort((a,b)=>Number(a.completed)-Number(b.completed)||a.dueAt-b.dueAt||a.createdAt-b.createdAt);
  const priority={high:['高','priority-high'],normal:['普通','priority-normal'],low:['低','priority-low']};
  $('todo-list').innerHTML=list.length?list.map(t=>'<article class="todo-card '+(t.completed?'completed ':'')+(!t.completed&&t.dueAt<now?'overdue':'')+'" data-id="'+esc(t.id)+'"><button class="todo-check" data-toggle="'+esc(t.id)+'" aria-label="'+(t.completed?'标记为未完成':'标记为完成')+'"></button><div class="todo-main"><div class="todo-title">'+esc(t.title)+'</div><div class="todo-meta"><span>'+esc(todoDateLabel(t.dueAt))+(t.dueAt<now&&!t.completed?' · 已逾期':'')+'</span><span>'+(t.alarmEnabled?'◷ 闹钟 '+esc(inputDateTime(t.alarmAt).time):t.remind?'通知':'无提醒')+'</span></div>'+(t.note?'<div class="todo-note">'+esc(t.note)+'</div>':'')+'</div><div><span class="priority '+priority[t.priority][1]+'">'+priority[t.priority][0]+'</span><button class="todo-edit" data-edit="'+esc(t.id)+'" aria-label="编辑待办">⋯</button></div></article>').join(''):'<div class="todo-empty"><strong>这里暂时是空的</strong><span>点击右上角“＋”添加一项待办</span></div>';
  let note='浏览器预览不会发送系统通知。';const native=window.Android&&typeof Android.notificationsEnabled==='function',enabled=native&&Android.notificationsEnabled(),exact=native&&Android.exactRemindersEnabled();
  if(native)note=!enabled?'通知未开启，待办已保存但无法发送提醒。':exact?'系统通知与准时提醒已开启。':'系统通知已开启；允许准时提醒后可按设定时间通知，否则可能延迟。';
  $('notification-note').textContent=native&&!enabled?'通知未开启':'';$('notification-settings').hidden=true;$('exact-settings').hidden=true;
}
$('notification-settings').onclick=()=>Android.openNotificationSettings();
$('exact-settings').onclick=()=>Android.requestExactReminders();
$('todo-list').onclick=e=>{const toggle=e.target.closest('[data-toggle]'),edit=e.target.closest('[data-edit]');if(toggle){const todo=state.todos.find(t=>t.id===toggle.dataset.toggle);if(todo){save({...state,todos:state.todos.map(t=>t.id===todo.id?{...t,completed:!t.completed}:t)});notify(todo.completed?'已恢复为待完成':'已完成');}return;}if(edit)editTodo(edit.dataset.edit);};
$('todo-filters').onclick=e=>{const button=e.target.closest('[data-filter]');if(!button)return;todoFilter=button.dataset.filter;document.querySelectorAll('.todo-filters button').forEach(b=>b.classList.toggle('selected',b===button));renderTodos();};
$('add-todo').onclick=()=>editTodo();
function inputDateTime(ms){const d=new Date(ms),pad=n=>String(n).padStart(2,'0');return {date:d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()),time:pad(d.getHours())+':'+pad(d.getMinutes())};}
function editTodo(id=null){
  const old=state.todos.find(t=>t.id===id);let due=Date.now()+3600000;due=Math.ceil(due/900000)*900000;const t=old||{id:uid(),title:'',dueAt:due,priority:'normal',note:'',completed:false,remind:true,createdAt:Date.now()},dt=inputDateTime(t.dueAt);
  showModal(old?'编辑待办':'新增待办','<form id="todo-form"><label>待办标题<input id="todo-title" maxlength="80" required placeholder="例如：提交实验报告" value="'+esc(t.title)+'"></label><div class="todo-form-grid"><label>日期<input id="todo-date" type="date" required value="'+dt.date+'"></label><label>时间<input id="todo-time" type="time" required value="'+dt.time+'"></label></div><label>优先级<select id="todo-priority"><option value="high" '+(t.priority==='high'?'selected':'')+'>高</option><option value="normal" '+(t.priority==='normal'?'selected':'')+'>普通</option><option value="low" '+(t.priority==='low'?'selected':'')+'>低</option></select></label><label>备注（选填）<textarea id="todo-note" maxlength="500" placeholder="补充材料、地点或说明">'+esc(t.note)+'</textarea></label><div class="switch-row"><label for="todo-remind">到点发送系统通知</label><input id="todo-remind" type="checkbox" '+(t.remind?'checked':'')+'></div><div id="form-error" class="error" role="alert"></div><div class="actions">'+(old?'<button type="button" class="danger" id="delete-todo">删除</button>':'')+'<button class="primary" type="submit">保存待办</button></div></form>');
  if(window.mountTodoAlarm)mountTodoAlarm(t);
  $('todo-form').onsubmit=e=>{e.preventDefault();try{const dueAt=new Date($('todo-date').value+'T'+$('todo-time').value).getTime();if(!Number.isFinite(dueAt))throw Error('请选择有效的日期和时间');const remind=$('todo-remind').checked,alarm=window.readTodoAlarm?readTodoAlarm(dueAt,t):{alarmEnabled:false,alarmAt:0};save({...state,todos:state.todos.filter(x=>x.id!==t.id).concat({...t,title:$('todo-title').value.trim(),dueAt,priority:$('todo-priority').value,note:$('todo-note').value.trim(),remind,...alarm})});closeModal();notify('待办已保存');if((remind||alarm.alarmEnabled)&&window.requestTodoPermissions)requestTodoPermissions(alarm.alarmEnabled);}catch(err){$('form-error').textContent=err.message;}};
  if(old)$('delete-todo').onclick=()=>confirmAction('删除这项待办？','将删除「'+t.title+'」，对应通知也会取消。',()=>{save({...state,todos:state.todos.filter(x=>x.id!==t.id)});notify('待办已删除');});
}

function settings(){
  showModal('设置与备份','<button class="setting-action" id="settings-times">作息时间<small>自定义课程和活动时间段</small></button><button class="setting-action" id="export">导出全部数据<small>保存课表、待办与作息备份</small></button><button class="setting-action" id="import">导入备份<small>从手机文件恢复，将替换当前全部数据</small></button><button class="setting-action" id="reset">恢复空白课表<small>清空课程并恢复初始作息，不删除事务待办</small></button><div class="version">Star Orbit 1.2.5 · 课表与待办</div>');
  $('settings-times').onclick=editTimes;$('export').onclick=exportData;$('import').onclick=()=>{if(window.Android)Android.openBackup();else $('import-file').click();};$('reset').onclick=()=>confirmAction('恢复空白课表？','当前课程将被清空、作息恢复初始值，事务待办会保留。',()=>{const fresh=C.defaults();save({...fresh,todos:state.todos});notify('已恢复空白课表');});
  if(window.extendSettings)window.extendSettings();
}
function partnerSettings(){
  showModal('搭子课表','<button class="setting-action" id="partner-import">配置导入<small>导入搭子分享的课表文件</small></button><button class="setting-action" id="partner-online">联网申请<small>后续版本开放，当前无需登录</small></button><button class="setting-action" id="partner-export">导出我的课表配置<small>发给搭子使用，不包含待办</small></button>'+(partner?'<button class="setting-action" id="partner-remove">移除搭子课表<small>仅删除本机保存的搭子课表</small></button>':'')+'<p class="hint">支持Star Orbit 1.0 / 1.1 备份和 1.2 课表配置。导入的是静态副本，更新需重新导入。完整备份可能包含待办，请优先分享“我的课表配置”。</p>');
  $('partner-import').onclick=()=>{if(window.Android)Android.openPartnerBackup();else $('partner-file').click();};
  $('partner-online').innerHTML='联网申请<small>搜索用户 ID、邀请和管理在线搭子</small>';
  $('partner-online').onclick=()=>window.openOnlinePartner&&window.openOnlinePartner();
  $('partner-export').onclick=()=>{const raw=JSON.stringify(C.scheduleOnly(state),null,2);if(window.Android)Android.exportBackup(raw);else downloadJson(raw,'Star Orbit-我的课表配置.json');};
  if(partner)$('partner-remove').onclick=()=>confirmAction('移除搭子课表？','自己的课表和待办不受影响。',()=>{persistPartner(null);viewPartner=false;renderSchedule();notify('搭子课表已移除');});
}
function persistPartner(next){
  const raw=next?JSON.stringify(next):'';
  if(window.Android){if(!Android.savePartner(raw))throw Error('搭子课表保存失败');}
  else if(next)localStorage.setItem('star-partner',raw);else localStorage.removeItem('star-partner');
  partner=next;
}
window.importPartner=raw=>{try{
  if(new TextEncoder().encode(raw).length>1024*1024)throw Error('文件不能超过 1 MB');
  const next=C.scheduleOnly(JSON.parse(raw));
  confirmAction(partner?'替换搭子课表？':'导入搭子课表？','包含 '+next.courses.length+' 门课程，将独立保存课程和作息，不导入待办。',()=>{persistPartner(next);viewPartner=true;renderSchedule();notify('搭子课表已导入');});
}catch(e){notify('导入失败：'+(e instanceof SyntaxError?'不是有效的 JSON 文件':e.message));}};
$('partner-manage').onclick=partnerSettings;
function selectSchedule(next){
  if(next&&!partner){partnerSettings();return;}
  viewPartner=next;renderSchedule();
}
$('schedule-mine').onclick=()=>selectSchedule(false);
$('schedule-partner').onclick=()=>selectSchedule(true);
const scheduleToggle=$('schedule-toggle');
let scheduleDrag=null,suppressToggleClickUntil=0;
scheduleToggle.onpointerdown=e=>{if(!e.isPrimary||e.button!==0||!partner)return;scheduleDrag={id:e.pointerId,start:e.clientX,initial:viewPartner?1:0,progress:viewPartner?1:0,moved:false};};
scheduleToggle.onpointermove=e=>{
  if(!scheduleDrag||scheduleDrag.id!==e.pointerId)return;
  const dx=e.clientX-scheduleDrag.start;
  if(!scheduleDrag.moved&&Math.abs(dx)<5)return;
  scheduleDrag.moved=true;scheduleToggle.setPointerCapture(e.pointerId);scheduleToggle.classList.add('dragging');
  const travel=(scheduleToggle.clientWidth-8)/2;
  scheduleDrag.progress=Math.max(0,Math.min(1,scheduleDrag.initial+dx/travel));
  scheduleToggle.style.setProperty('--progress',scheduleDrag.progress);
};
scheduleToggle.onpointerup=e=>{
  if(!scheduleDrag||scheduleDrag.id!==e.pointerId)return;
  const drag=scheduleDrag;scheduleDrag=null;scheduleToggle.classList.remove('dragging');
  if(drag.moved){suppressToggleClickUntil=Date.now()+300;selectSchedule(drag.progress>=0.5);}
};
function cancelScheduleDrag(){if(!scheduleDrag)return;scheduleDrag=null;scheduleToggle.classList.remove('dragging');scheduleToggle.style.setProperty('--progress',viewPartner?1:0);}
scheduleToggle.onpointercancel=cancelScheduleDrag;scheduleToggle.onlostpointercapture=cancelScheduleDrag;
scheduleToggle.addEventListener('click',e=>{if(Date.now()<suppressToggleClickUntil){e.preventDefault();e.stopPropagation();suppressToggleClickUntil=0;}},true);
scheduleToggle.onkeydown=e=>{if(['ArrowLeft','ArrowDown','Home','ArrowRight','ArrowUp','End'].includes(e.key)){e.preventDefault();const next=['ArrowRight','ArrowUp','End'].includes(e.key);selectSchedule(next);$(next?'schedule-partner':'schedule-mine').focus();}};
$('partner-file').onchange=async e=>{const file=e.target.files[0];try{if(file){if(file.size>1024*1024)throw Error('文件不能超过 1 MB');window.importPartner(await file.text());}}catch(err){notify('导入失败：'+err.message);}finally{e.target.value='';}};
function downloadJson(raw,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已生成课表配置');}
function exportData(){const raw=JSON.stringify(state,null,2);if(window.Android){Android.exportBackup(raw);return;}const a=document.createElement('a'),url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.href=url;a.download='Star Orbit与待办备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已生成备份文件');}
window.importBackup=raw=>{try{if(raw.length>1024*1024)throw Error('备份文件过大');const next=C.validate(JSON.parse(raw)),lessons=next.slots.filter(s=>s.kind!=='activity').length,activities=next.slots.length-lessons;confirmAction('导入这份备份？','包含 '+lessons+' 节课、'+activities+' 个活动时间段、'+next.courses.length+' 个课程块和 '+next.todos.length+' 项待办。导入将替换当前数据。',()=>{save(next);notify('数据已导入');});}catch(e){notify(e instanceof SyntaxError?'导入失败：不是有效的 JSON 备份文件':'导入失败：'+e.message);}};
$('import-file').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>1024*1024)notify('备份文件不能超过 1 MB');else window.importBackup(await file.text());}e.target.value='';};

render();setInterval(()=>{tick();if(activePage==='todos')renderTodos();},15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();renderTodos();}});
if(loadingError){showModal('本地数据暂时无法读取','<p class="hint">目前显示默认数据，原始数据仍保留在本机。请先导出原始数据，再决定是否修改。</p><button class="primary" id="export-raw">导出原始数据</button>');$('export-raw').onclick=()=>{const raw=window.Android?Android.loadData():localStorage.getItem('star-schedule');if(window.Android)Android.exportBackup(raw||'');else notify('请从浏览器本地存储保存原始数据');};}
