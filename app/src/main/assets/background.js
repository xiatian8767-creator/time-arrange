(function(){
  'use strict';
  const key='star-schedule-background',empty=()=>({image:'',transparency:70});
  const native=window.Android&&typeof Android.loadBackground==='function';
  function load(){try{const value=JSON.parse((native?Android.loadBackground():localStorage.getItem(key))||'null');return value&&typeof value.image==='string'&&(!value.image||/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.image))&&Number.isFinite(value.transparency)&&value.transparency>=0&&value.transparency<=100?value:empty();}catch(e){return empty();}}
  let value=load(),generation=0;
  const shell=document.querySelector('.schedule-shell'),layer=document.createElement('img');
  layer.className='schedule-background';layer.alt='';layer.setAttribute('aria-hidden','true');shell.prepend(layer);
  function render(){
    layer.hidden=!value.image;if(value.image)layer.src=value.image;else layer.removeAttribute('src');
    layer.style.opacity=String(1-value.transparency/100);
    const preview=document.getElementById('background-preview');
    if(preview){preview.hidden=!value.image;if(value.image)preview.src=value.image;else preview.removeAttribute('src');preview.style.opacity=layer.style.opacity;}
    const label=document.getElementById('background-percent');if(label)label.textContent=value.transparency+'%';
  }
  function save(next){try{const raw=JSON.stringify(next);if(raw.length>3*1024*1024)throw Error();if(native){if(!Android.saveBackground(raw))throw Error();}else localStorage.setItem(key,raw);value=next;render();return true;}catch(e){value=load();render();notify('背景保存失败，请选择较小的图片');return false;}}
  window.receiveBackgroundPhoto=async src=>{
    const current=++generation;
    try{
      const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});
      if(current!==generation)return;
      const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      if(save({...value,image:canvas.toDataURL('image/jpeg',0.85)}))notify('课表背景已保存');
    }catch(e){notify('无法读取图片，请换一张图片');}
  };
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.hidden=true;document.body.appendChild(input);
  input.onchange=()=>{const file=input.files[0];input.value='';if(!file)return;if(!file.type.startsWith('image/')||file.size>15*1024*1024)return notify('请选择 15 MB 以内的图片');const reader=new FileReader();reader.onload=()=>window.receiveBackgroundPhoto(reader.result);reader.onerror=()=>notify('读取图片失败');reader.readAsDataURL(file);};
  function settings(){
    showModal('课表背景','<p class="hint">图片仅保存在此设备，应用于我的课表和搭子课表，不会上传或随课表分享。选择和调整后自动保存。</p><div class="background-preview-box"><img id="background-preview" alt="背景预览"><span>课程文字预览</span></div><button id="background-upload" class="setting-action">选择背景图片</button><label for="background-transparency">背景透明度 <output id="background-percent"></output><input id="background-transparency" type="range" min="0" max="100" step="1" value="'+value.transparency+'"></label><p class="hint">0% 为完全显示图片，100% 为隐藏图片；课程文字和卡片保持清晰。</p><button id="background-reset" class="secondary">恢复默认背景</button>');
    render();document.getElementById('background-upload').onclick=()=>native?Android.pickBackground():input.click();
    const range=document.getElementById('background-transparency');range.oninput=()=>{value={...value,transparency:Number(range.value)};render();};range.onchange=()=>save({...value});
    document.getElementById('background-reset').onclick=()=>{generation++;if(save(empty())){range.value=value.transparency;notify('已恢复默认背景');}};
  }
  const previous=window.extendSettings;window.extendSettings=()=>{if(previous)previous();const button=document.createElement('button');button.className='setting-action';button.id='background-settings';button.textContent='课表背景 · 图片与透明度';button.onclick=settings;document.getElementById('dialog-body').prepend(button);};
  render();
})();
