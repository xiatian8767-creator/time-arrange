'use strict';
(function(){
  const CLOUD_BASE_URL='https://8.154.43.154';
  const native=window.Online,requests=new Map();let memoryAI={},syncing=false,applying=false,syncTimer,epoch=0,onlineMate=false,partnerInfo=null;
  function read(name){try{const raw=native?Online.load(name):localStorage.getItem('star-v2-'+name);const value=raw?JSON.parse(raw):{};if(value.vaultError)throw Error();return value;}catch(e){notify('加密设置读取失败，请重新配置；本机课表未删除');return {};}}
  function write(name,value){if(native){if(!Online.store(name,JSON.stringify(value)))throw Error('加密设置保存失败');}else if(name==='ai')memoryAI=value;else localStorage.setItem('star-v2-'+name,JSON.stringify(value));}
  let cloud=read('cloud'),scope=native?Online.scope():(localStorage.getItem('star-v2-scope')||'guest'),syncStatus='离线可用';
  // Never forward a session from a previously configured, different server.
  // Keep its local account document intact; a new login selects its own scope.
  if(cloud.user&&cloud.baseUrl!==CLOUD_BASE_URL){cloud={baseUrl:CLOUD_BASE_URL};write('cloud',cloud);notify('请重新登录；原有本机数据已保留');}
  if(!cloud.user)cloud={baseUrl:CLOUD_BASE_URL};
  if(cloud.user&&scope!==accountScope(cloud)){cloud={baseUrl:cloud.baseUrl};write('cloud',cloud);}
  const rawState=()=>JSON.stringify(state),isDirty=()=>rawState()!==cloud.synced;
  function accountScope(c){return c.baseUrl+'#'+c.user.userId;}
  function persist(){write('cloud',cloud);}
  function lockAccount(locked){window.authLocked=locked;document.body.classList.toggle('auth-required',locked);for(const node of document.querySelectorAll('main,.bottom-nav,#ai-fab'))node.inert=locked;}
  window.onlineResult=(id,status,body,json)=>{const pending=requests.get(id);if(!pending)return;requests.delete(id);clearTimeout(pending.timer);let data;try{data=json?JSON.parse(body):{detail:body};}catch(e){data={detail:'服务器返回格式不正确'};}if(status>=200&&status<300)pending.resolve(data);else{const error=Error(typeof data.detail==='string'?data.detail:'请求失败（'+status+'）');error.status=status;pending.reject(error);}};
  function transport(req){if(!native)return Promise.reject(Error('联网和 AI 功能请在安卓安装包中使用；浏览器仅提供离线预览'));return new Promise((resolve,reject)=>{const id=uid(),timer=setTimeout(()=>{requests.delete(id);reject(Error('请求超时，请重试'));},105000);requests.set(id,{resolve,reject,timer});Online.request(id,JSON.stringify(req));});}
  let refreshing=null;
  async function api(path,method='GET',body,retry=true){
    const generation=epoch;
    try{return await transport({target:'cloud',path:'/api/v1'+path,method,body,token:cloud.accessToken||''});}
    catch(e){
      if(e.status===401&&retry&&cloud.refreshToken){
        if(!refreshing)refreshing=transport({target:'cloud',path:'/api/v1/auth/refresh',method:'POST',body:{refreshToken:cloud.refreshToken}}).then(tokens=>{if(epoch!==generation)throw Error('账号已切换');cloud={...cloud,...tokens};persist();}).finally(()=>refreshing=null);
        try{await refreshing;}catch(refreshError){if(refreshError.status===401&&epoch===generation){cloud.needsLogin=true;persist();lockAccount(true);loginForm();}throw refreshError;}if(epoch!==generation)throw Error('账号已切换');return api(path,method,body,false);
      }throw e;
    }
  }
  function cached(target){if(target===scope)return rawState();return native?Online.accountData(target):(localStorage.getItem('star-document-'+target)||'');}
  function localPartner(){try{const raw=window.Android?Android.loadPartner():localStorage.getItem('star-partner');return raw?C.scheduleOnly(JSON.parse(raw)):null;}catch(e){return null;}}
  function clearOnlineMate(){if(onlineMate){partner=localPartner();onlineMate=false;viewPartner=false;renderSchedule();}partnerInfo=null;}
  function activate(nextCloud,document,target){
    const clean=C.validate(document),raw=JSON.stringify(clean);
    if(native){if(!Online.activate(target,raw,JSON.stringify(nextCloud)))throw Error('账号切换保存失败');}
    else{localStorage.setItem('star-document-'+scope,rawState());localStorage.setItem('star-partner-'+scope,localStorage.getItem('star-partner')||'');localStorage.setItem('star-v2-scope',target);localStorage.setItem('star-schedule',raw);localStorage.setItem('star-partner',localStorage.getItem('star-partner-'+target)||'');write('cloud',nextCloud);}
    epoch++;cloud=nextCloud;scope=target;state=clean;partner=localPartner();onlineMate=false;partnerInfo=null;viewPartner=false;render();
    history=[];photo=null;$('ai-messages').replaceChildren();$('ai-photo-preview').hidden=true;$('ai-photo').removeAttribute('src');
  }
  function setDocument(document){applying=true;try{save(document);}finally{applying=false;}}
  function summary(doc){return doc?doc.courses.length+' 门课程 / '+doc.slots.length+' 个时间段 / '+doc.todos.length+' 项待办':'云端尚无数据';}
  async function refreshPartner(){const generation=epoch;const info=await api('/partner');if(epoch!==generation)return;if(document.hidden){clearOnlineMate();return;}partnerInfo=info;if(info.partner&&info.partner.schedule){partner=C.scheduleOnly(info.partner.schedule);onlineMate=true;renderSchedule();}else clearOnlineMate();partnerInfo=info;}
  async function sync(manual=false){
    if(!cloud.user||syncing)return;syncing=true;const generation=epoch;
    try{
      const remote=await api('/me/data');if(epoch!==generation)return;
      const remoteRaw=remote.document?JSON.stringify(C.validate(remote.document)):null;
      if(remote.revision!==cloud.revision){
        if(isDirty()&&rawState()!==remoteRaw){syncStatus='两台设备都有修改，请处理冲突';if(manual)conflict(remote);await refreshPartner();return;}
        if(remote.document)setDocument(remote.document);cloud.revision=remote.revision;cloud.synced=remoteRaw;persist();
      }
      if(isDirty()){
        const sent=rawState(),result=await api('/me/data','PUT',{baseRevision:cloud.revision,document:JSON.parse(sent)});if(epoch!==generation)return;
        cloud.revision=result.revision;cloud.synced=sent;persist();
      }
      syncStatus='已同步 · '+new Date().toLocaleTimeString();await refreshPartner();if(manual)notify(syncStatus);
    }catch(e){syncStatus=e.status===409?'云端已有修改，请再次同步处理冲突':e.message;clearOnlineMate();if(manual)notify(syncStatus);}
    finally{syncing=false;}
  }
  function conflict(remote){
    const base=rawState(),generation=epoch;
    showModal('多设备数据冲突','<p class="hint">本机：'+summary(state)+'<br>云端：'+summary(remote.document)+'</p><p class="danger-note">不会自动覆盖。请先导出本机备份，选择后将替换一整份课表和待办。</p><button id="conflict-export" class="setting-action">先导出本机备份</button><button id="conflict-cloud" class="setting-action">使用云端数据（替换本机）</button><button id="conflict-local" class="setting-action">保留本机数据（覆盖云端）</button>');
    $('conflict-export').onclick=exportData;
    $('conflict-cloud').onclick=()=>{if(epoch!==generation||rawState()!==base)return notify('本机数据已变化，请重新同步');if(!remote.document)return notify('云端为空，请选择保留本机');setDocument(remote.document);cloud.revision=remote.revision;cloud.synced=rawState();persist();closeModal();notify('已使用云端数据');};
    $('conflict-local').onclick=async()=>{if(epoch!==generation||rawState()!==base)return notify('本机数据已变化，请重新同步');try{const result=await api('/me/data','PUT',{baseRevision:remote.revision,document:JSON.parse(base)});if(epoch!==generation)return;cloud.revision=result.revision;cloud.synced=base;persist();closeModal();notify('云端已更新');}catch(e){notify(e.message);}};
  }
  window.addEventListener('star-data-changed',()=>{if(applying)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(),1800);});
  setInterval(()=>{if(!document.hidden&&$('modal').hidden)sync();},45000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();else clearOnlineMate();});

  window.extendSettings=()=>{
    $('dialog-body').insertAdjacentHTML('afterbegin','<button class="setting-action" id="account-settings">'+(cloud.user?'账号与同步':'注册 / 登录')+'<small>'+(cloud.user?esc(cloud.user.nickname)+' · '+esc(syncStatus):'按需联网，跨设备恢复课表和私人待办')+'</small></button><button class="setting-action" id="ai-settings">AI 助手设置<small>密钥仅保存在此设备</small></button>');
    $('account-settings').onclick=accountSettings;$('ai-settings').onclick=aiSettings;
    document.querySelector('.version').textContent='Star Orbit 2.1beta · 探索版';

  };
  function accountSettings(){
    if(!cloud.user){loginForm();return;}
    showModal('账号与同步','<div class="account-banner"><strong>'+esc(cloud.user.nickname)+'</strong><small>用户 ID：'+esc(cloud.user.userId)+'</small><small>'+esc(syncStatus)+'</small></div><p class="hint">当前数据属于此账号；退出后恢复未登录时的本机数据。待办仅本人可读取。</p><button id="cloud-sync" class="setting-action">立即同步</button><button id="cloud-partner" class="setting-action">管理在线搭子</button><button id="cloud-logout" class="setting-action">退出登录</button>');
    $('cloud-sync').onclick=()=>sync(true);$('cloud-partner').onclick=window.openOnlinePartner;
    $('cloud-logout').insertAdjacentHTML('beforebegin','<button id="security-settings" class="setting-action">保密问题<small>设置或更换找回密码的答案</small></button>');$('security-settings').onclick=()=>securityForm(false);
    $('cloud-logout').onclick=()=>{
      showModal('退出登录？','<p class="hint">账号数据保留在本机，重新登录后可继续使用。'+(isDirty()?'你还有未同步修改，请先导出备份或同步。':'')+'</p><button id="logout-export" class="setting-action">导出当前备份</button><button id="logout-confirm" class="danger">退出登录</button>');
      $('logout-export').onclick=exportData;$('logout-confirm').textContent='退出登录';$('logout-confirm').onclick=async()=>{if(syncing)return notify('正在同步，请稍后');$('logout-confirm').disabled=true;try{await api('/auth/logout','POST',{});}catch(e){}try{const guest=cached('guest');activate({baseUrl:cloud.baseUrl},guest?JSON.parse(guest):C.defaults(),'guest');lockAccount(true);loginForm();syncStatus='待登录';}catch(e){notify(e.message);}};
    };
  }
  function loginForm(){
    showModal('欢迎来到 Star Orbit','<p class="hint">登录后，开始安排你的日常。</p><form id="login-form"><label>用户名<input id="login-name" autocomplete="username" required pattern="[a-zA-Z0-9_]{3,32}" placeholder="3–32 位字母、数字或下划线"></label><label>密码<input id="login-password" type="password" autocomplete="current-password" required minlength="10" maxlength="128" placeholder="至少 10 位"></label><label>昵称（注册时填写）<input id="login-nickname" maxlength="30"></label><button type="button" class="text-action" id="forgot-password">忘记密码？</button><div class="error" id="login-error" role="alert"></div><div class="cloud-actions"><button class="primary" id="login-submit" type="submit">登录</button><button class="secondary" id="register-submit" type="button">注册</button></div></form>');
    $('forgot-password').onclick=recoveryForm;
    const submit=async register=>{
      if(!$('login-form').reportValidity())return;
      const error=$('login-error'),buttons=[$('login-submit'),$('register-submit')];buttons.forEach(x=>x.disabled=true);
      try{
        const baseUrl=CLOUD_BASE_URL,body={username:$('login-name').value.trim(),password:$('login-password').value};
        if(register){body.nickname=$('login-nickname').value.trim();if(!body.nickname)throw Error('注册时请填写昵称');}
        cloud={baseUrl};persist();
        const tokens=await api(register?'/auth/register':'/auth/login','POST',body,false);
        const candidate={baseUrl,...tokens};
        const remote=await transport({target:'cloud',path:'/api/v1/me/data',method:'GET',token:tokens.accessToken});
        candidate.securityRequired=Boolean(remote.security&&remote.security.required);selectInitial(candidate,remote);
      }catch(e){error.textContent=e.message;}finally{buttons.forEach(x=>x.disabled=false);}
    };
    $('login-form').onsubmit=e=>{e.preventDefault();submit(false);};$('register-submit').onclick=()=>submit(true);
  }
  function selectInitial(candidate,remote){
    const target=accountScope(candidate),stored=cached(target),local=stored?C.validate(JSON.parse(stored)):(scope==='guest'?C.validate(state):C.defaults());
    const localLabel=stored?'此账号的本机副本':'当前访客数据';
    showModal('选择首次同步方向','<p class="hint">'+localLabel+'：'+summary(local)+'<br>云端：'+summary(remote.document)+'</p><p class="hint">不自动合并或覆盖。访客原始数据会保留在独立空间，退出登录后可恢复。</p><button id="use-cloud" class="setting-action">'+(remote.document?'使用云端数据':'以空白账号开始')+'</button><button id="use-local" class="setting-action">将'+localLabel+'同步到这个账号</button>');
    const choose=useLocal=>{try{const doc=useLocal?local:(remote.document||C.defaults());activate({...candidate,revision:remote.revision,synced:remote.document?JSON.stringify(C.validate(remote.document)):null},doc,target);syncStatus='待同步';if(candidate.securityRequired){lockAccount(true);securityForm(true);}else{lockAccount(false);closeModal();sync(true);checkCampaign();}}catch(e){notify(e.message);}};
    $('use-cloud').onclick=()=>choose(false);$('use-local').onclick=()=>choose(true);
  }

  window.openOnlinePartner=async()=>{
    if(!cloud.user){loginForm();return;}
    const generation=epoch;
    try{await refreshPartner();}catch(e){clearOnlineMate();notify(e.message);return;}
    const info=partnerInfo;
    if(epoch!==generation||!info||document.hidden)return;
    showModal('在线搭子','<p class="hint">我的 ID：'+esc(cloud.user.userId)+'<br>绑定后仅共享昵称、ID、课表和作息，待办始终私有。</p>'+(info.partner?'<div class="account-banner"><strong>'+esc(info.partner.nickname)+'</strong><small>'+esc(info.partner.userId)+'</small></div><button id="online-unbind" class="danger">解除绑定</button>':'<form id="partner-search"><label>精确搜索用户 ID<input id="lookup-id" required pattern="[a-f0-9]{12}" maxlength="12" placeholder="12 位用户 ID"></label><button class="primary">搜索</button></form><div id="lookup-result"></div>')+'<h3>收到的邀请</h3><div id="incoming-list"></div><h3>发出的邀请</h3><div id="outgoing-list"></div>');
    for(const direction of ['incoming','outgoing']){
      $(direction+'-list').innerHTML=info[direction].length?info[direction].map(i=>'<div class="invitation"><strong>'+esc(i.user.nickname)+'</strong><small>'+esc(i.user.userId)+'</small><div class="cloud-actions">'+(direction==='incoming'?'<button class="primary" data-invitation="'+esc(i.id)+'" data-action="accept">同意</button><button class="secondary" data-invitation="'+esc(i.id)+'" data-action="reject">拒绝</button>':'<button class="secondary" data-invitation="'+esc(i.id)+'" data-action="withdraw">撤回</button>')+'</div></div>').join(''):'<p class="hint">暂无邀请</p>';
    }
    $('dialog-body').querySelectorAll('[data-invitation]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/partner/invitations/'+b.dataset.invitation,'PATCH',{action:b.dataset.action});await window.openOnlinePartner();}catch(e){notify(e.message);b.disabled=false;}});
    if(info.partner)$('online-unbind').onclick=()=>{
      showModal('解除搭子绑定？','<p class="hint">解除后双方不能继续读取对方课表。此前已经查看或自行保存的内容无法远程收回。</p><button class="danger" id="unbind-confirm">确认解除</button>');
      $('unbind-confirm').onclick=async()=>{try{await api('/partner','DELETE');clearOnlineMate();await window.openOnlinePartner();}catch(e){notify(e.message);}};
    };
    else $('partner-search').onsubmit=async e=>{e.preventDefault();try{const user=await api('/users/lookup?userId='+encodeURIComponent($('lookup-id').value));$('lookup-result').innerHTML='<div class="invitation"><strong>'+esc(user.nickname)+'</strong><small>'+esc(user.userId)+'</small><button id="send-invite" class="primary">发送搭子邀请</button></div>';$('send-invite').onclick=async()=>{try{await api('/partner/invitations','POST',{userId:user.userId});await window.openOnlinePartner();}catch(err){notify(err.message);}};}catch(err){notify(err.message);}};
  };

  // AI conversation stays in memory. Keys never enter export, cloud sync or JS requests.
  let history=[],photo=null,aiBusy=false;
  const defaults={deepseek:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash'},qwen:{baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3-vl-plus'}};
  function aiSettings(){
    const config=native?read('ai'):memoryAI,provider=config.provider||'deepseek';
    showModal('AI 助手设置','<form id="ai-config-form"><p class="hint">选择服务商并填写 API Key，即可开始。使用费用由服务商收取。</p><label>服务商<select id="ai-provider"><option value="deepseek">DeepSeek</option><option value="qwen">Qwen（通义千问）</option></select></label><input id="ai-base" type="hidden" value="'+esc(config.baseUrl||defaults[provider].baseUrl)+'"><input id="ai-model" type="hidden" value="'+esc(config.model||defaults[provider].model)+'"><label>API Key<input id="ai-key" type="password" autocomplete="off" maxlength="1000" placeholder="'+(config.key?'已保存；留空保持原 Key':'填写个人 API Key')+'"></label><p class="hint">照片识别请选择 Qwen。</p><div class="cloud-actions"><button type="button" id="ai-key-delete" class="danger">删除 Key</button><button class="primary">保存</button></div></form>');
    $('ai-provider').value=provider;$('ai-provider').onchange=()=>{const d=defaults[$('ai-provider').value];$('ai-base').value=d.baseUrl;$('ai-model').value=d.model;$('ai-key').value='';$('ai-key').placeholder='服务商已切换，请填写对应 Key';};
    $('ai-config-form').onsubmit=e=>{e.preventDefault();try{const p=$('ai-provider').value,key=$('ai-key').value.trim()||(p===provider?config.key:'');if(!key)throw Error('请填写 API Key');const url=new URL($('ai-base').value.trim());if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('请填写有效 HTTPS 官方地址');write('ai',{provider:p,key,baseUrl:url.href.replace(/\/$/,''),model:$('ai-model').value.trim()});closeModal();notify(native?'设置已保存':'浏览器预览不支持联网；Key 未持久保存');}catch(err){notify(err.message);}};
    $('ai-key-delete').onclick=()=>{write('ai',{});closeModal();notify('Key 已删除');};
  }
  function message(text,role='assistant'){const el=document.createElement('div');el.className='ai-message '+role;el.textContent=text;$('ai-messages').appendChild(el);$('ai-welcome').hidden=true;el.scrollIntoView({block:'end'});return el;}
  function openAI(){if(window.authLocked)return;closeModal();$('ai-panel').hidden=false;document.body.style.overflow='hidden';$('ai-welcome').hidden=Boolean($('ai-messages').children.length);}
  function closeAI(){$('ai-panel').hidden=true;document.body.style.overflow='';$('ai-fab').focus();}
  $('ai-close').onclick=closeAI;$('ai-config').onclick=aiSettings;
  const oldBack=window.handleBack;window.handleBack=()=>{if(!$('modal').hidden)return oldBack();if(!$('ai-panel').hidden){closeAI();return true;}return oldBack();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('modal').hidden&&!$('ai-panel').hidden)closeAI();});
  window.receiveAIPhoto=data=>{photo=data;$('ai-photo').src=data;$('ai-photo-preview').hidden=false;};
  $('ai-upload').onclick=()=>native?Online.pickPhoto(false):notify('请在安卓应用中选择照片');$('ai-camera').onclick=()=>native?Online.pickPhoto(true):notify('请在安卓应用中拍照');
  $('ai-photo-remove').onclick=()=>{photo=null;$('ai-photo').removeAttribute('src');$('ai-photo-preview').hidden=true;};
  $('ai-clear').onclick=()=>{if(aiBusy)return notify('请等待当前请求完成');history=[];$('ai-messages').replaceChildren();$('ai-photo-remove').click();$('ai-welcome').hidden=false;};
  function readable(value,slots){
    if(!value)return '无';
    if(value.slots)return '作息：'+value.slots.map(s=>(s.label||s.id)+' '+s.start+'–'+s.end).join('；')+'\n课程：\n'+(value.courses.map(c=>readable(c,value.slots)).join('\n')||'空白课表');
    if(value.title)return value.title+'\n时间：'+new Date(value.dueAt).toLocaleString()+'\n优先级：'+({low:'低',normal:'普通',high:'高'})[value.priority]+' · '+(value.completed?'已完成':'未完成')+' · '+(value.remind?'通知':'不通知')+(value.alarmEnabled?'\n闹钟：'+new Date(value.alarmAt).toLocaleString():'\n闹钟：关闭')+(value.note?'\n备注：'+value.note:'');
    const start=slots.find(s=>s.id===value.start),end=slots.find(s=>s.id===value.end);
    return value.name+' · 周'+DAYS[value.day-1]+' '+(start?start.start:value.start)+'–'+(end?end.end:value.end)+(value.room?' · '+value.room:'')+(value.note?'\n备注：'+value.note:'');
  }
  function preview(result,base,generation){
    showModal('确认 AI 修改','<p class="hint">'+esc(result.message)+'</p>'+(result.warnings.length?'<p class="danger-note">请核对不确定信息：<br>'+result.warnings.map(esc).join('<br>')+'</p>':'')+result.changes.map(change=>'<div class="diff-card"><strong>'+esc(change.type)+'</strong><p class="hint">修改前</p><pre>'+esc(readable(change.before,JSON.parse(base).slots))+'</pre><p class="hint">修改后</p><pre>'+esc(readable(change.after,result.next.slots))+'</pre></div>').join('')+'<p class="hint">确认后写入“我的课表 / 私人待办”，已登录时也会同步。不会修改搭子的课表。</p><div class="cloud-actions"><button id="ai-cancel" class="secondary">取消</button><button id="ai-apply" class="primary">确认全部修改</button></div>');
    $('ai-cancel').onclick=closeModal;$('ai-apply').onclick=()=>{try{if(generation!==epoch||rawState()!==base)throw Error('数据或账号已变化，这份建议已失效，请重新生成');save(result.next);closeModal();message('你已确认，修改已保存。');notify('AI 修改已应用');if(result.next.todos.some(t=>t.alarmEnabled&&!t.completed)&&window.requestTodoPermissions)window.requestTodoPermissions(true);}catch(e){notify(e.message);}};
  }
  $('ai-form').onsubmit=async e=>{
    e.preventDefault();if(aiBusy)return;
    const config=native?read('ai'):memoryAI;if(!config.key){aiSettings();return;}
    const prompt=$('ai-input').value.trim(),sentPhoto=photo;if(!prompt&&!sentPhoto)return;
    const base=rawState(),generation=epoch,permissions={schedule:true,todos:true};
    const context={version:2,now:Date.now(),localTime:new Date().toString()};if(permissions.schedule){context.slots=state.slots;context.courses=state.courses;}if(permissions.todos)context.todos=state.todos;
    const system='你是Star Orbit助手。仅输出 JSON 对象：{"message":"中文回答","warnings":["不确定信息"],"operations":[]}。聊天时 operations 为空。所有操作都是等待用户确认的建议，不要宣称已执行。只使用用户授权提供的数据。不确定的图片文字不得编造。支持 type: course.create/course.update/course.delete/todo.create/todo.update/todo.delete（字段 id，value 不含 id）；新记录生成唯一字符串 id，update 只列变化字段。course value 包含 day(1-7),start/end(时间段id),name,color(#rrggbb),room,note；todo value 包含 title,dueAt(毫秒),createdAt(毫秒),priority(low/normal/high),note,completed,remind,alarmEnabled(布尔，默认false),alarmAt(毫秒，默认0)。只有用户明确要求闹钟才开启alarmEnabled，并提供alarmAt；普通提醒只设remind。更换作息或整张课表只允许 schedule.replace，带完整 slots 和 courses 数组（课程含 id），保留待办。slots 包含 id,start/end(HH:mm)，活动段可含 kind:activity,label。时间不重叠，课程不冲突。课程与待办字段长度限制分别遵循名称30/标题80/地点60/备注500。当前授权上下文 JSON：'+JSON.stringify(context);
    const content=sentPhoto?[{type:'text',text:prompt||'请查看图片，识别其中的安排；不确定的内容先询问，所有修改先给出建议。'},{type:'image_url',image_url:{url:sentPhoto}}]:prompt;
    const sent=message(prompt,'user');if(sentPhoto){const img=document.createElement('img');img.src=sentPhoto;img.alt='本条消息的图片';img.className='ai-sent-photo';sent.append(img);}photo=null;$('ai-photo-preview').hidden=true;$('ai-photo').removeAttribute('src');$('ai-input').value='';aiBusy=true;$('ai-send').disabled=true;const waiting=message('正在思考，请稍候……');
    try{
      // Conversation contains only user prompts / answers, not prior private contexts or images.
      const contract='补充协议：权限为 '+JSON.stringify(permissions)+'。未授权的类型不得生成操作，请在 message 中提示勾选对应权限。create 不需要 id，由客户端生成；update/delete 的 id 必须来自上下文已有记录。待办 dueAt 优先使用带时区的 ISO 8601 日期时间，例如 2026-10-04T09:00:00+08:00，禁止秒时间戳。用户未指定具体时刻时先询问，不生成待办。缺省 priority=normal、completed=false、remind=false、note=""，只有明确要求提醒才设置 remind=true。操作示例：{"message":"请预览确认","warnings":[],"operations":[{"type":"todo.create","value":{"title":"喝一杯牛奶","dueAt":"2026-10-04T09:00:00+08:00"}}]}。示例时间仅展示格式，实际日期根据当前时间和用户要求计算。';
      const scheduleContract='当前客户端支持修改作息，不要沿用历史回复中的不支持结论。仅调整作息请使用 {"type":"slots.replace","slots":[完整时间段]}，保留已有课程引用的 id；按图片导入新作息与课程用 {"type":"schedule.replace","slots":[完整时间段],"courses":[完整课程]}。整表替换必须保留用户未要求删除的现有课程并适配新节次；不能确定映射就询问。也可先 slots.replace 再逐条 course.create；新增课程 id 可省略，color/room/note 可省略。示例：{"type":"schedule.replace","slots":[{"id":"s1","start":"08:00","end":"08:45"}],"courses":[{"day":1,"start":"s1","end":"s1","name":"数学"}]}。图片任务应同时识别节次时间和课程，不能因为现有作息缺少节次就拒绝。校验错误应修正字段和操作，不要声称客户端没有明确列出的能力。';
      const messages=[{role:'system',content:system+'\n'+contract+'\n'+scheduleContract},...history.slice(-8),{role:'user',content}];
      const requestAI=()=>transport({target:'ai',body:{model:config.model,messages,stream:false,max_tokens:8192,response_format:{type:'json_object'}}});
      let response=await requestAI();
      if(generation!==epoch)throw Error('账号已切换，已丢弃此回复');
      const choice=response.choices&&response.choices[0];if(!choice||choice.finish_reason==='length')throw Error('回复不完整，请缩小任务后重试');
      let result;
      try{result=StarAI.proposal(JSON.parse(base),StarAI.parse(choice.message.content),permissions);}
      catch(validationError){
        if(validationError.message.includes('勾选')||validationError.message.includes('未授权'))throw validationError;
        waiting.textContent='正在校正建议格式，请稍候……';
        messages.push({role:'assistant',content:choice.message.content},{role:'user',content:'返回数据未通过客户端校验：'+validationError.message+'。请按协议修正原建议；缺少用户信息时请询问，并返回空 operations。只输出 JSON。'});
        response=await requestAI();
        if(generation!==epoch)throw Error('账号已切换，已丢弃此回复');
        const corrected=response.choices&&response.choices[0];
        if(!corrected||corrected.finish_reason==='length')throw Error('回复不完整，请缩小任务后重试');
        result=StarAI.proposal(JSON.parse(base),StarAI.parse(corrected.message.content),permissions);
      }
      waiting.textContent=result.message;history.push({role:'user',content:prompt},{role:'assistant',content:result.message});history=history.slice(-8);
      if(result.changes.length){const button=document.createElement('button');button.className='primary';button.textContent='预览 '+result.changes.length+' 项修改';button.onclick=()=>preview(result,base,generation);waiting.appendChild(button);}
    }catch(err){waiting.textContent='未修改任何数据：'+err.message;}finally{aiBusy=false;$('ai-send').disabled=false;}
  };
  const fab=$('ai-fab');let drag=null,suppress=false;
  function place(x,y){fab.style.left=Math.max(8,Math.min(innerWidth-60,x))+'px';fab.style.top=Math.max(8,Math.min(innerHeight-70,y))+'px';fab.style.right='auto';fab.style.bottom='auto';}
  const pos=read('position');if(Number.isFinite(pos.x)&&Number.isFinite(pos.y))place(pos.x,pos.y);
  fab.onpointerdown=e=>{if(e.button!==0)return;const rect=fab.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,moved:false};fab.setPointerCapture(e.pointerId);};
  fab.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved)place(drag.left+dx,drag.top+dy);};
  fab.onpointerup=()=>{if(!drag)return;suppress=drag.moved;if(drag.moved){const r=fab.getBoundingClientRect();write('position',{x:r.left,y:r.top});}drag=null;};fab.onpointercancel=()=>{drag=null;suppress=true;};
  fab.onclick=()=>{if(suppress){suppress=false;return;}openAI();};window.addEventListener('resize',()=>{const r=fab.getBoundingClientRect();place(r.left,r.top);});
  const SECURITY_QUESTIONS={place:'你记忆深刻的一个地方是？',phrase:'你为自己设置的秘密短语是？',character:'你喜欢的一个角色是？',memory:'你想记住的一件小事是？',object:'对你有特别意义的一件物品是？'};
  window.openSecuritySettings=()=>{if(!cloud.user||cloud.needsLogin){loginForm();return;}securityForm(Boolean(cloud.securityRequired));};
  function securityForm(required){
    showModal(required?'设置保密问题':'保密问题','<p class="hint">写下只有你知道答案的问题。</p><form id="security-form"><label>当前密码<input id="security-password" type="password" required minlength="10" maxlength="128" autocomplete="current-password" placeholder="验证是你本人"></label>'+[1,2].map(i=>'<fieldset class="security-card"><legend><span>0'+i+'</span>保密问题</legend><label class="security-question-label" for="security-question'+i+'">你的问题</label><input id="security-question'+i+'" required minlength="3" maxlength="30" autocomplete="off" placeholder="自己写一个问题，或从下方选择"><details class="security-suggestions"><summary>选一个常用问题<span aria-hidden="true">＋</span></summary><div>'+Object.entries(SECURITY_QUESTIONS).map(([key,label])=>'<button type="button" data-question="'+key+'" data-field="'+i+'">'+esc(label)+'</button>').join('')+'</div></details><label>你的答案<input id="security-answer'+i+'" type="text" inputmode="text" spellcheck="false" required minlength="1" maxlength="128" autocomplete="off" placeholder="请输入答案"></label></fieldset>').join('')+'<div id="security-error" class="error" role="alert"></div><button class="primary wide-action">保存保密问题</button></form>'+(required?'<button id="security-return" class="text-action">换个账号登录</button>':''));
    document.querySelectorAll('[data-question]').forEach(button=>{button.onclick=()=>{const input=$('security-question'+button.dataset.field);input.value=SECURITY_QUESTIONS[button.dataset.question];button.closest('details').open=false;$('security-answer'+button.dataset.field).focus();};});
    if(required)$('security-return').onclick=()=>{cloud.needsLogin=true;persist();loginForm();};
    $('security-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/me/security','POST',{password:$('security-password').value,question1:$('security-question1').value,question2:$('security-question2').value,answer1:$('security-answer1').value,answer2:$('security-answer2').value});cloud.securityRequired=false;persist();lockAccount(false);closeModal();notify('保密问题已保存');sync();checkCampaign();}catch(err){if($('security-error'))$('security-error').textContent=err.message;}finally{button.disabled=false;}};
  }
  function recoveryForm(){
    showModal('找回密码','<p class="hint">任选一道保密问题答对，即可重置密码。</p><form id="recovery-form"><label>用户名<input id="recovery-name" required pattern="[a-zA-Z0-9_]{3,32}" autocomplete="username"></label><div id="recovery-answers"></div><div id="recovery-error" class="error" role="alert"></div><button class="primary wide-action" id="recovery-next">下一步</button></form><button class="text-action" id="recovery-back">返回登录</button>');
    let username=null;$('recovery-back').onclick=loginForm;
    $('recovery-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{if(!username){const name=$('recovery-name').value.trim(),result=await api('/auth/recovery/questions','POST',{username:name},false);username=name;$('recovery-name').readOnly=true;$('recovery-answers').innerHTML=result.questions.map((q,i)=>'<label>'+esc(q)+'<input id="recovery-answer'+i+'" type="text" inputmode="text" spellcheck="false" placeholder="任选一题填写" maxlength="128" autocomplete="off"></label>').join('')+'<label>新密码<input id="recovery-password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label><label>确认新密码<input id="recovery-confirm" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>';$('recovery-next').textContent='重置密码';}else{if($('recovery-password').value!==$('recovery-confirm').value)throw Error('两次密码不一致');await api('/auth/recovery/reset','POST',{username,answer1:$('recovery-answer0').value,answer2:$('recovery-answer1').value,password:$('recovery-password').value},false);loginForm();notify('密码已重置，请使用新密码登录');}}catch(err){if($('recovery-error'))$('recovery-error').textContent=err.message;}finally{button.disabled=false;}};
  }
  let campaignBusy=false,campaignEntry=0,campaignActive=null;
  async function checkCampaign(continuing=false,skipped=[]){
    if(campaignActive&&campaignActive.generation!==epoch)campaignActive=null;
    if(!cloud.user||cloud.needsLogin||window.authLocked||document.hidden||!$('modal').hidden||!$('ai-panel').hidden||campaignBusy||campaignActive||skipped.length>=200||(!continuing&&Date.now()-campaignEntry<3000))return;
    campaignEntry=Date.now();campaignBusy=true;const generation=epoch;
    try{const result=await api('/campaigns'+(skipped.length?'?skip='+skipped.join(','):''));if(generation!==epoch||window.authLocked||!$('modal').hidden||!$('ai-panel').hidden||document.hidden)return;const item=result.campaign;if(!item||skipped.includes(item.id))return;const key=item.id+':'+result.period;if((cloud.campaignReceipts||[]).includes(key)){setTimeout(()=>{if(generation===epoch)checkCampaign(true,[...skipped,item.id]);},0);return;}if(!native||typeof Online.showCampaign!=='function')return;campaignActive={id:item.id,key,generation,skipped,ack:Promise.resolve()};Online.showCampaign(JSON.stringify(item));}catch(e){}finally{campaignBusy=false;}
  }
  window.campaignResult=(id,loaded)=>{const current=campaignActive;if(!current||current.id!==id||current.generation!==epoch)return;if(loaded){cloud.campaignReceipts=[...(cloud.campaignReceipts||[]),current.key].slice(-200);persist();current.ack=api('/campaigns/'+id+'/displayed','POST',{}).catch(()=>{});}};
  window.campaignClosed=async id=>{const current=campaignActive;if(!current||current.id!==id)return;await current.ack;if(campaignActive!==current)return;campaignActive=null;setTimeout(()=>{if(current.generation===epoch)checkCampaign(true,[...current.skipped,id]);},250);};
  window.appEntered=()=>{if(!window.authLocked)checkCampaign();};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.appEntered();});
  lockAccount(!cloud.user||Boolean(cloud.needsLogin)||Boolean(cloud.securityRequired));
  if(!cloud.user||cloud.needsLogin)loginForm();else if(cloud.securityRequired)securityForm(true);else if(!loadingError)setTimeout(()=>{sync();checkCampaign();},500);
})();
