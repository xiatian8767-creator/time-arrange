(function(){
 'use strict';const fab=$('ai-fab');fab.innerHTML='<span class="plush-body"></span>';fab.setAttribute('aria-label','星小助，点击聊天，拖动调整位置');
 const native=window.Online;let mode='roam',lastTouch=performance.now(),drag=null,suppress=false,path=null,previousTime=0,poseAt=performance.now()+8000;
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');
 try{mode=JSON.parse((native?Online.load('mascot'):localStorage.getItem('orbit-mascot'))||'{}').mode||mode;}catch(e){}
 let r=fab.getBoundingClientRect(),x=r.left,y=r.top;
 function bounds(){return {minX:0,maxX:Math.max(0,innerWidth-86),minY:70,maxY:Math.max(70,innerHeight-172)};}
 function place(){const b=bounds();x=Math.max(b.minX,Math.min(b.maxX,x));y=Math.max(b.minY,Math.min(b.maxY,y));fab.style.left=x+'px';fab.style.top=y+'px';fab.style.right='auto';fab.style.bottom='auto';}
 function apply(){fab.hidden=mode==='hidden';path=null;lastTouch=performance.now();}apply();place();
 fab.onpointerdown=e=>{if(e.button!==0)return;path=null;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:x,top:y,moved:false};fab.setPointerCapture(e.pointerId);fab.classList.add('dragging');};
 fab.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){x=drag.left+dx;y=drag.top+dy;place();}};
 function end(){if(!drag)return;suppress=drag.moved;drag=null;lastTouch=performance.now();fab.classList.remove('dragging');if(suppress){const value=JSON.stringify({x,y});if(native)Online.store('position',value);else localStorage.setItem('star-v2-position',value);}}
 fab.onpointerup=end;fab.onpointercancel=()=>{end();suppress=true;};
 const oldClick=fab.onclick;fab.onclick=()=>{if(suppress){suppress=false;return;}fab.dataset.pose='happy';if(oldClick)oldClick();};
 document.addEventListener('pointerdown',e=>{if(!fab.contains(e.target)){lastTouch=performance.now();path=null;}},{passive:true});
 function frame(now){
  const dt=previousTime?Math.min((now-previousTime)/1000,.04):0;previousTime=now;
  const quiet=document.hidden||!$('modal').hidden||!$('ai-panel').hidden||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  fab.classList.toggle('quiet',quiet);
  if(!quiet&&!drag&&mode!=='hidden'&&!reduced.matches&&now>poseAt){fab.dataset.pose=['idle','sleep','wink','happy'][Math.floor(Math.random()*4)];poseAt=now+5000+Math.random()*7000;}
  if(mode==='roam'&&!drag&&!quiet&&!reduced.matches&&now-lastTouch>7000){
   if(!path){const b=bounds(),nx=x<innerWidth/2?b.minX:b.maxX,ny=Math.max(b.minY,Math.min(b.maxY,y+(Math.random()<.5?-1:1)*(70+Math.random()*110)));
    const blocked=document.elementsFromPoint(nx+43,ny+43).some(el=>el!==fab&&!fab.contains(el)&&el.closest('button,input,textarea,select,.course'));
    if(!blocked&&Math.hypot(nx-x,ny-y)>15)path={sx:x,sy:y,tx:nx,ty:ny,t:0,duration:Math.max(12,Math.hypot(nx-x,ny-y)/7)};
    else lastTouch=now-4000;
   }
   if(path){path.t=Math.min(1,path.t+dt/path.duration);const p=path.t,e=p*p*(3-2*p);x=path.sx+(path.tx-path.sx)*e;y=path.sy+(path.ty-path.sy)*e;place();if(p===1){path=null;lastTouch=now;}}
  }
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);document.addEventListener('visibilitychange',()=>{previousTime=0;lastTouch=performance.now();});
 window.addEventListener('resize',()=>{path=null;place();});
 const previous=window.extendSettings;window.extendSettings=()=>{if(previous)previous();const label=document.createElement('label');label.textContent='星小助';const select=document.createElement('select');select.id='mascot-mode';for(const [v,text] of [['roam','自由活动'],['fixed','固定位置'],['hidden','隐藏']])select.add(new Option(text,v));select.value=mode;select.onchange=()=>{mode=select.value;const raw=JSON.stringify({mode});if(native)Online.store('mascot',raw);else localStorage.setItem('orbit-mascot',raw);apply();};label.append(select);$('dialog-body').prepend(label);};
})();
