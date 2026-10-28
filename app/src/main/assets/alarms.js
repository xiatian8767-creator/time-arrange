(function(){
 'use strict';
 const native=window.Android&&typeof Android.requestTodoPermissions==='function';
 function permissions(alarm=false){if(native)Android.requestTodoPermissions(alarm);else notify('请在安卓应用中开启通知权限');}
 window.requestTodoPermissions=permissions;
 function status(){try{return JSON.parse(Android.alarmStatus());}catch(e){return null;}}
 function openPermissions(){
  if(!native||typeof Android.alarmStatus!=='function')return permissions(true);
  showModal('通知和闹钟','<div id="alarm-settings"></div>');window.refreshAlarmSettings();
 }
 window.refreshAlarmSettings=()=>{
  const box=document.getElementById('alarm-settings'),s=status();if(!box||!s)return;
  const rows=[['notifications','通知提醒',s.notifications,'已开启','未开启'],['exact','准时响铃',s.exact,'已允许','需要允许闹钟和提醒'],['channel','闹钟通知',s.channel,'已开启','已关闭'],['fullscreen','锁屏显示',s.fullscreen,'已允许','需要允许全屏提醒'],['volume','闹钟音量',s.volume>0,'已开启','当前为静音'],['battery','后台运行',s.battery,'不受电池优化限制','建议设为不限制，并允许自启动']];
  box.innerHTML=rows.map(([key,title,ok,yes,no])=>'<button type="button" class="alarm-setting-row" data-alarm-setting="'+key+'"><span>'+title+'<small>'+ (ok?yes:no)+'</small></span><span class="'+(ok?'alarm-ready':'alarm-attention')+'">'+(ok?'✓':'去设置')+'</span></button>').join('')+'<p class="hint">响铃使用系统的闹钟音量。部分手机需在应用信息中允许自启动、后台运行；强行停止应用后，请重新打开一次。</p>';
  box.querySelectorAll('[data-alarm-setting]').forEach(b=>b.onclick=()=>Android.openAlarmSetting(b.dataset.alarmSetting));
 };
 window.checkAlarmReadiness=()=>{const s=status();if(s&&(!s.exact||!s.notifications||!s.channel||s.volume===0))openPermissions();};
 const previous=window.extendSettings;
 window.extendSettings=()=>{if(previous)previous();const b=document.createElement('button');b.className='setting-action';b.id='notification-permissions';b.textContent='通知和闹钟';b.onclick=openPermissions;$('dialog-body').prepend(b);};
 const button=document.createElement('button');button.className='secondary';button.id='notification-shortcut';button.textContent='通知和闹钟';button.onclick=openPermissions;document.querySelector('.reminder-actions').append(button);
 const style=document.createElement('style');style.textContent='.alarm-setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:16px;margin:0 0 10px;border:1px solid #e2e4e9;border-radius:16px;background:#fff;color:#1c2945;text-align:left;font-size:15px}.alarm-setting-row small{display:block;color:#778193;font-size:12px;line-height:1.5;margin-top:5px}.alarm-ready{color:#398570}.alarm-attention{color:#9c7134;font-size:12px;white-space:nowrap}';document.head.append(style);
 window.mountTodoAlarm=(todo)=>{
  const dt=inputDateTime(todo.alarmAt||todo.dueAt);const delta=(todo.dueAt-(todo.alarmAt||todo.dueAt))/60000;
  $('todo-remind').closest('.switch-row').insertAdjacentHTML('afterend','<div class="switch-row"><label for="todo-alarm">闹钟提醒</label><input type="checkbox" id="todo-alarm" '+(todo.alarmEnabled?'checked':'')+'></div><div id="alarm-options"><label>响铃时间<select id="alarm-offset"><option value="0">待办到点时</option><option value="5">提前 5 分钟</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="custom">自定义时间</option></select></label><div class="todo-form-grid" id="alarm-custom"><label>日期<input type="date" id="alarm-date" value="'+dt.date+'"></label><label>时间<input type="time" id="alarm-time" value="'+dt.time+'"></label></div><p class="hint">到点响铃，可关闭或稍后 5 分钟提醒。</p></div>');
  $('alarm-offset').value=[0,5,10,30].includes(delta)?String(delta):'custom';
  function update(){$('alarm-options').hidden=!$('todo-alarm').checked;$('alarm-custom').hidden=$('alarm-offset').value!=='custom';}
  $('todo-alarm').onchange=update;$('alarm-offset').onchange=update;update();
 };
 window.readTodoAlarm=(dueAt,todo)=>{
  const alarmEnabled=$('todo-alarm').checked;
  const alarmAt=alarmEnabled?($('alarm-offset').value==='custom'?new Date($('alarm-date').value+'T'+$('alarm-time').value).getTime():dueAt-Number($('alarm-offset').value)*60000):0;
  if(alarmEnabled&&(!Number.isSafeInteger(alarmAt)||alarmAt<=0))throw Error('请选择有效的闹钟时间');
  if(alarmEnabled&&alarmAt<=Date.now()&&(!todo.alarmEnabled||todo.alarmAt!==alarmAt))throw Error('请选择未来的闹钟时间');
  return {alarmEnabled,alarmAt};
 };
})();
