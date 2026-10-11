(function(){
  'use strict';
  const shapes={calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m6 0h2m-10 4h2"/>',check:'<path d="m5 12 4 4 10-10"/>',settings:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 3 4-5 5 7"/>',camera:'<path d="M3 7h4l2-3h6l2 3h4v14H3Z"/><circle cx="12" cy="13" r="4"/>',refresh:'<path d="M20 7a9 9 0 1 0 1 7M20 3v5h-5"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
  const svg=name=>'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">'+shapes[name]+'</svg>';
  for(const [id,name,label] of [['nav-schedule','calendar','课表'],['nav-todos','check','待办'],['settings','settings','设置']])$(id).innerHTML=svg(name)+'<span>'+label+'</span>';
  for(const [id,name,label] of [['ai-upload','image','选择图片'],['ai-camera','camera','拍照'],['ai-clear','refresh','清空对话'],['ai-send','arrow','发送'],['ai-config','settings','助手设置'],['ai-close','close','关闭助手']]){$(id).innerHTML=svg(name);$(id).setAttribute('aria-label',label);}
  document.querySelectorAll('[data-ai-prompt]').forEach(b=>b.onclick=()=>{$('ai-input').value=b.dataset.aiPrompt;$('ai-input').focus();});$('ai-photo-start').onclick=()=>$('ai-upload').click();
  window.decorateSettings=()=>{
    const content=$('settings-content');const groups=[['账号',['account-settings']],['日常偏好',['background-settings','mascot-mode','settings-times']],['服务与提醒',['notification-permissions','ai-settings']],['我的数据',['export','import','reset']]];
    const fragment=document.createDocumentFragment();
    groups.forEach(([title,ids])=>{const section=document.createElement('section');section.className='settings-group';const heading=document.createElement('h3');heading.textContent=title;fragment.append(heading);ids.forEach(id=>{const node=$(id);if(!node)return;const row=node.tagName==='SELECT'?node.parentElement:node;if(id==='account-settings')row.classList.add('settings-account');if(id==='background-settings')row.textContent='课表背景';if(id==='ai-settings')row.innerHTML='AI 助手';if(id==='settings-times')row.innerHTML='作息时间';if(id==='export')row.innerHTML='导出备份';section.append(row);});if(section.children.length)fragment.append(section);});
    const version=content.querySelector('.version');if(version)fragment.append(version);content.append(fragment);
  };
})();
