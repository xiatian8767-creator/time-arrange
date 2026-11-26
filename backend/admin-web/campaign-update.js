'use strict';
(() => {
  const kind = $('campaign-kind');
  kind.add(new Option('版本更新', 'update'));
  const editor = document.createElement('div');
  editor.hidden = true;
  editor.innerHTML = `
    <div class="campaign-grid">
      <label>目标版本号（versionCode）<input id="update-code" type="number" min="32" max="2147483647" value="32"></label>
      <label>APK 下载链接<input id="update-url" type="url" placeholder="https://…/StarOrbit.apk"></label>
    </div>
    <p>低于目标版本的设备每次打开 App 都会收到提示，直到安装更新。</p>
    <div class="update-studio">
      <div class="update-phone" id="update-phone">
        <div class="update-phone-header" aria-hidden="true">Star Orbit</div><div class="update-phone-grid" aria-hidden="true"></div>
        <div class="release-card update-preview" id="update-card">
          <img class="release-bg" id="update-bg-preview" alt="" hidden>
          <div class="release-copy" id="update-copy"></div>
          <span class="update-close" aria-hidden="true">×</span>
          <span class="release-action">立即更新</span>
          <button class="update-handle card-size" type="button" id="update-size" aria-label="拖动改变弹窗大小"></button>
        </div>
      </div>
      <div class="update-inspector">
        <label>背景色<input id="update-bg-color" type="color" value="#f6f5f1"></label>
        <label>背景图片<input id="update-bg-file" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <div class="update-tools"><button type="button" id="update-remove-bg">移除背景图</button></div>
        <p id="update-upload-status" role="status"></p>
        <div class="update-tools">
          <button type="button" id="update-draw" aria-pressed="false">画文本框</button>
          <button type="button" id="update-add">添加文本框</button>
          <button type="button" id="update-remove">删除文本框</button>
        </div>
        <div id="update-text-settings">
          <label>文字<textarea id="update-text" maxlength="500" rows="3"></textarea></label>
          <div class="campaign-grid">
            <label>字体<select id="update-font"><option value="sans">系统黑体</option><option value="serif">衬线</option><option value="mono">等宽</option></select></label>
            <label>字号（弹窗宽度 %）<input id="update-font-size" type="number" min="2.5" max="14" step="0.5"></label>
            <label>文字颜色<input id="update-text-color" type="color"></label>
            <label>对齐<select id="update-align"><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></label>
          </div>
          <label class="campaign-check"><input id="update-bold" type="checkbox">加粗</label>
        </div>
      </div>
    </div>`;
  $('campaign-url').closest('label').nextElementSibling.after(editor);

  const card = $('update-card'), copy = $('update-copy'), phone = $('update-phone');
  const width = $('campaign-width'), height = $('campaign-height'), frequency = $('campaign-frequency');
  const fonts = {sans:'system-ui', serif:'serif', mono:'monospace'};
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const box = (text='新文字') => ({text,x:8,y:24,width:84,height:24,size:5,color:'#1c2945',font:'sans',bold:false,align:'left'});
  let boxes=[], selected=-1, image='', drawing=false, drag=null, generation=0, uploading=false, formerFrequency='once';

  function paintBox(el, value) {
    Object.assign(el.style,{left:value.x+'%',top:value.y+'%',width:value.width+'%',height:value.height+'%',
      color:value.color,fontFamily:fonts[value.font],fontWeight:value.bold?'700':'400',textAlign:value.align});
    el.style.setProperty('--text-size',value.size);
  }
  function layout() {
    card.style.width=clamp(Number(width.value)||88,60,96)+'%';
    card.style.height=clamp(Number(height.value)||65,30,90)+'%';
    card.style.backgroundColor=$('update-bg-color').value;
    const bg=$('update-bg-preview');
    bg.hidden=!image;
    if(image)bg.src=image;else bg.removeAttribute('src');
  }
  function render() {
    layout();
    copy.replaceChildren();
    copy.classList.toggle('drawing',drawing);
    $('update-draw').setAttribute('aria-pressed',drawing);
    boxes.forEach((value,index) => {
      const el=document.createElement('div');
      el.className='release-text'+(index===selected?' selected':'');
      el.dataset.box=index;
      el.textContent=value.text;
      paintBox(el,value);
      if(index===selected){
        const handle=document.createElement('button');
        handle.type='button';handle.className='update-handle';
        handle.setAttribute('aria-label','拖动改变文本框大小');
        el.append(handle);
      }
      copy.append(el);
    });
  }
  function inspect() {
    const value=boxes[selected];
    $('update-text-settings').hidden=!value;
    $('update-remove').disabled=!value;
    if(!value)return;
    $('update-text').value=value.text;$('update-font').value=value.font;
    $('update-font-size').value=value.size;$('update-text-color').value=value.color;
    $('update-align').value=value.align;$('update-bold').checked=value.bold;
  }
  function toggleDraw(on) {drawing=on;render();}
  window.resetCampaignUpdate = entry => {
    generation++;uploading=false;drawing=false;drag=null;
    const update=entry?.update;
    $('update-code').value=update?.targetCode||32;
    $('update-url').value=update?entry.url:'';
    $('update-bg-color').value=update?.background||'#f6f5f1';
    $('update-bg-file').value='';$('update-upload-status').textContent='';
    image=update?.image||'';
    boxes=update?update.boxes.map(value=>({...value})):[
      {...box('发现新版本'),y:16,height:17,size:9,bold:true},
      {...box('在这里填写本次更新内容'),y:41,height:45}
    ];
    formerFrequency=frequency.value;selected=boxes.length?0:-1;
    render();inspect();
  };
  window.showCampaignUpdate = show => {
    if(show&&!frequency.disabled)formerFrequency=frequency.value;
    if(!show&&frequency.disabled)frequency.value=formerFrequency;
    editor.hidden=!show;
    $('campaign-editor').classList.toggle('is-update',show);
    $('update-url').required=show;$('update-code').required=show;
    frequency.disabled=show;
    if(show){frequency.value='always';layout();}
  };
  window.campaignUpdatePayload = () => {
    if(kind.value!=='update')return null;
    if(uploading)throw Error('请等待背景图上传完成');
    const url=$('update-url').value.trim();
    const link=new URL(url);
    if(link.protocol!=='https:'||!link.pathname.endsWith('.apk'))throw Error('请填写 HTTPS APK 直链');
    const round=value=>Math.round(value*1000)/1000;
    return {url,frequency:'always',update:{targetCode:Number($('update-code').value),background:$('update-bg-color').value,image,
      boxes:boxes.filter(value=>value.text.trim()).map(value=>({...value,x:round(value.x),y:round(value.y),width:round(value.width),height:round(value.height)}))}};
  };
  for(const control of [width,height,$('update-bg-color')])control.addEventListener('input',layout);
  $('update-bg-file').onchange=async()=>{
    const file=$('update-bg-file').files[0];if(!file)return;
    const request=++generation;uploading=true;$('update-upload-status').textContent='正在上传…';
    try{const path=await uploadCampaignImage(file);if(request===generation){image=path+'asset';layout();$('update-upload-status').textContent='';}}
    catch(error){if(request===generation)$('update-upload-status').textContent=error.message;}
    finally{if(request===generation)uploading=false;}
  };
  $('update-remove-bg').onclick=()=>{generation++;uploading=false;image='';$('update-bg-file').value='';$('update-upload-status').textContent='';layout();};
  $('update-draw').onclick=()=>{if(boxes.length<12)toggleDraw(!drawing);};
  $('update-add').onclick=()=>{if(boxes.length<12){selected=boxes.push(box())-1;toggleDraw(false);inspect();$('update-text').focus();}};
  $('update-remove').onclick=()=>{if(selected>=0){boxes.splice(selected,1);selected=boxes.length?Math.min(selected,boxes.length-1):-1;render();inspect();}};
  for(const [id,key] of Object.entries({text:'text',font:'font','font-size':'size','text-color':'color',align:'align',bold:'bold'})){
    $('update-'+id).oninput=event=>{
      if(!boxes[selected])return;
      const input=event.target;
      boxes[selected][key]=key==='bold'?input.checked:key==='size'?clamp(Number(input.value)||5,2.5,14):input.value;
      render();
    };
  }
  phone.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const node=event.target.closest('[data-box]');
    if(event.target.id==='update-size'){
      drag={mode:'card',rect:phone.getBoundingClientRect(),x:event.clientX,y:event.clientY,w:Number(width.value),h:Number(height.value)};
    }else if(drawing&&copy.contains(event.target)&&boxes.length<12){
      const rect=copy.getBoundingClientRect();
      const x=clamp((event.clientX-rect.left)*100/rect.width,0,96),y=clamp((event.clientY-rect.top)*100/rect.height,0,94);
      selected=boxes.push({...box(),x,y,width:4,height:6})-1;
      drag={mode:'resize',rect,x:event.clientX,y:event.clientY,value:{...boxes[selected]}};
    }else if(node){
      selected=Number(node.dataset.box);
      drag={mode:event.target.classList.contains('update-handle')?'resize':'move',rect:copy.getBoundingClientRect(),
        x:event.clientX,y:event.clientY,value:{...boxes[selected]}};
    }else return;
    event.preventDefault();phone.setPointerCapture(event.pointerId);render();inspect();
  });
  phone.addEventListener('pointermove',event=>{
    if(!drag)return;
    const dx=(event.clientX-drag.x)*100/drag.rect.width,dy=(event.clientY-drag.y)*100/drag.rect.height;
    if(drag.mode==='card'){
      width.value=clamp(Math.round(drag.w+2*dx),60,96);
      height.value=clamp(Math.round(drag.h+2*dy),30,90);
    }else{
      const value=boxes[selected],original=drag.value;
      if(drag.mode==='move'){
        value.x=clamp(original.x+dx,0,100-original.width);value.y=clamp(original.y+dy,0,100-original.height);
      }else{
        value.width=clamp(original.width+dx,4,100-value.x);value.height=clamp(original.height+dy,6,100-value.y);
      }
    }
    render();
  });
  function finishDrag(){if(!drag)return;drag=null;if(drawing){toggleDraw(false);$('update-text').focus();}}
  phone.addEventListener('pointerup',finishDrag);phone.addEventListener('pointercancel',finishDrag);
})();
