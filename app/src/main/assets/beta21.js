(function(){
  'use strict';
  window.celebrateTodo=rect=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const colors=['#c4a56b','#7b9fd3','#e8b5bf','#9abca9','#e7cd83'];
    for(let i=0;i<34;i++){
      const bit=document.createElement('i');bit.className='todo-confetti';bit.setAttribute('aria-hidden','true');
      bit.style.background=colors[i%colors.length];bit.style.left=(rect.left+rect.width*(.12+Math.random()*.76))+'px';bit.style.top=(rect.top+Math.min(rect.height/2,35))+'px';document.body.append(bit);
      const x=(Math.random()-.5)*150,y=50+Math.random()*90,rotation=(Math.random()-.5)*700;
      const animation=bit.animate([{transform:'translate(0,0) rotate(0)',opacity:0},{transform:`translate(${x*.5}px,${-45-Math.random()*55}px) rotate(${rotation*.4}deg)`,opacity:1,offset:.3},{transform:`translate(${x}px,${y}px) rotate(${rotation}deg)`,opacity:0}],{duration:950+Math.random()*350,easing:'cubic-bezier(.2,.65,.4,1)'});
      animation.onfinish=()=>bit.remove();
    }
  };
})();
