(function(){
 'use strict';
 const native=window.Android&&typeof Android.requestTodoPermissions==='function';
 function permissions(alarm=false){if(native)Android.requestTodoPermissions(alarm);else notify('请在安卓应用中开启通知权限');}
 window.requestTodoPermissions=permissions;
 const openPermissions=()=>native?Android.openTodoPermissions():permissions(true);
 const previous=window.extendSettings;
 window.extendSettings=()=>{if(previous)previous();const b=document.createElement('button');b.className='setting-action';b.id='notification-permissions';b.textContent='通知权限';b.onclick=openPermissions;$('dialog-body').prepend(b);};
 const button=document.createElement('button');button.className='secondary';button.id='notification-shortcut';button.textContent='通知权限';button.onclick=openPermissions;document.querySelector('.reminder-actions').append(button);
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
