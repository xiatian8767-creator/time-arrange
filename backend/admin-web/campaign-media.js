// Image campaigns use a hosted image page, also compatible with older clients.
(()=>{
 const form=$('campaign-form'),url=$('campaign-url'),label=url.closest('label');
 const controls=document.createElement('div');controls.innerHTML='<label>内容类型<select id="campaign-kind"><option value="h5">H5 页面</option><option value="image">图片</option></select></label><div id="campaign-image-editor" hidden><label>上传图片<input id="campaign-image-file" type="file" accept="image/jpeg,image/png,image/webp"></label><p id="campaign-image-status"></p><img id="campaign-image-preview" alt="活动图片预览" hidden style="max-width:100%;max-height:240px;border-radius:12px;object-fit:contain"></div>';
 label.before(controls);let busy=false,version=0,ready='',draft='';
 function show(){const image=$('campaign-kind').value==='image';label.hidden=image;$('campaign-image-editor').hidden=!image;url.required=!image;url.value=image?ready:draft;}
 window.syncCampaignMedia=()=>{version++;busy=false;ready='';draft=url.value;const isImage=/\/updates\/images\/[a-f0-9]{32}\/$/.test(url.value);$('campaign-kind').value=isImage?'image':'h5';if(isImage){ready=url.value;draft='';}$('campaign-image-file').value='';$('campaign-image-status').textContent='';$('campaign-image-preview').hidden=!isImage;if(isImage)$('campaign-image-preview').src=ready+'asset';show();};
 $('campaign-kind').onchange=()=>{if(!label.hidden)draft=url.value;show();};
 $('campaign-image-file').onchange=async()=>{
  const file=$('campaign-image-file').files[0];if(!file)return;const current=++version;busy=true;$('campaign-image-status').textContent='正在上传…';
  let bitmap;
  try{if(file.size>20*1024*1024)throw Error('请选择小于 20 MB 的图片');bitmap=await createImageBitmap(file);const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);let image='';for(let quality=.9;quality>=.3;quality-=.1){image=canvas.toDataURL('image/jpeg',quality);if(image.length<240000)break;}if(image.length>=240000)throw Error('图片细节过多，请缩小后重试');const result=await api('campaign-images',{image});if(current!==version)return;ready=location.origin+result.path;if($('campaign-kind').value==='image')url.value=ready;$('campaign-image-preview').src=ready+'asset';$('campaign-image-preview').hidden=false;$('campaign-image-status').textContent='图片已上传，保存弹窗后生效';}catch(e){if(current===version)$('campaign-image-status').textContent=e.message;}finally{bitmap?.close();if(current===version)busy=false;}
 };
 form.addEventListener('submit',e=>{if(busy||($('campaign-kind').value==='image'&&!ready)){e.preventDefault();e.stopImmediatePropagation();$('campaign-error').textContent=busy?'请等待图片上传完成':'请先上传图片';}},true);
})();
