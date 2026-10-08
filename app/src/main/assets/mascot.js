(function(){
 const fab=$('ai-fab');fab.innerHTML='<span class="star-body"></span><span class="star-eyes"></span><span class="star-smile"></span><span class="star-cheeks"></span>';fab.setAttribute('aria-label','星小助，点击对话，可拖动');
 const native=window.Online;let mode='roam',held=false,last=Date.now();try{const v=native?Online.load('mascot'):localStorage.getItem('orbit-mascot');mode=JSON.parse(v||'{}').mode||mode;}catch(e){}
 function apply(){fab.hidden=mode==='hidden';fab.classList.toggle('fixed',mode==='fixed');}
 fab.addEventListener('pointerdown',()=>{held=true;last=Date.now();fab.classList.add('dragging');});for(const event of ['pointerup','pointercancel'])fab.addEventListener(event,()=>{held=false;last=Date.now();fab.classList.remove('dragging');});
 document.addEventListener('pointerdown',e=>{if(!fab.contains(e.target))last=Date.now();},{passive:true});
 setInterval(()=>{
  const quiet=document.hidden||!$('modal').hidden||!$('ai-panel').hidden||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);fab.classList.toggle('quiet',quiet);
  if(mode!=='roam'||held||quiet||Date.now()-last<12000||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const x=Math.random()<.5?4:innerWidth-64,y=Math.max(80,Math.min(innerHeight-160,80+Math.random()*(innerHeight-240)));
  // Stay at an edge and only move to a point that does not cover controls.
  const behind=document.elementsFromPoint(x+30,y+30).filter(el=>el!==fab&&!fab.contains(el));
  if(behind.some(el=>el.closest('button,input,textarea,select,.course')))return;
  fab.style.left=x+'px';fab.style.top=y+'px';fab.style.right='auto';fab.style.bottom='auto';last=Date.now();
 },4000);
 const previous=window.extendSettings;window.extendSettings=()=>{if(previous)previous();const label=document.createElement('label');label.textContent='星小助活动方式';const select=document.createElement('select');select.id='mascot-mode';for(const [value,text] of [['roam','自由活动'],['fixed','固定位置'],['hidden','隐藏']]){const option=new Option(text,value);select.add(option);}select.value=mode;select.onchange=()=>{mode=select.value;const raw=JSON.stringify({mode});if(native)Online.store('mascot',raw);else localStorage.setItem('orbit-mascot',raw);apply();};label.append(select);$('dialog-body').prepend(label);};apply();
})();
