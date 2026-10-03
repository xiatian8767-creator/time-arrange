'use strict';
(function(){
  const native=window.Online,requests=new Map();let memoryAI={},syncing=false,applying=false,syncTimer,epoch=0,onlineMate=false,partnerInfo=null;
  function read(name){try{const raw=native?Online.load(name):localStorage.getItem('star-v2-'+name);const value=raw?JSON.parse(raw):{};if(value.vaultError)throw Error();return value;}catch(e){notify('加密设置读取失败，请重新配置；本机课表未删除');return {};}}
  function write(name,value){if(native){if(!Online.store(name,JSON.stringify(value)))throw Error('加密设置保存失败');}else if(name==='ai')memoryAI=value;else localStorage.setItem('star-v2-'+name,JSON.stringify(value));}
  let cloud=read('cloud'),scope=native?Online.scope():(localStorage.getItem('star-v2-scope')||'guest'),syncStatus='离线可用';
  if(cloud.user&&scope!==accountScope(cloud)){cloud={baseUrl:cloud.baseUrl};write('cloud',cloud);}
  const rawState=()=>JSON.stringify(state),isDirty=()=>rawState()!==cloud.synced;
  function accountScope(c){return c.baseUrl+'#'+c.user.userId;}
  function persist(){write('cloud',cloud);}
  function validBase(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('请输入 HTTPS 服务器根地址，不含路径和账号');return u.origin;}
  window.onlineResult=(id,status,body,json)=>{const pending=requests.get(id);if(!pending)return;requests.delete(id);clearTimeout(pending.timer);let data;try{data=json?JSON.parse(body):{detail:body};}catch(e){data={detail:'服务器返回格式不正确'};}if(status>=200&&status<300)pending.resolve(data);else{const error=Error(typeof data.detail==='string'?data.detail:'请求失败（'+status+'）');error.status=status;pending.reject(error);}};
  function transport(req){if(!native)return Promise.reject(Error('联网和 AI 功能请在安卓安装包中使用；浏览器仅提供离线预览'));return new Promise((resolve,reject)=>{const id=uid(),timer=setTimeout(()=>{requests.delete(id);reject(Error('请求超时，请重试'));},105000);requests.set(id,{resolve,reject,timer});Online.request(id,JSON.stringify(req));});}
  let refreshing=null;
  async function api(path,method='GET',body,retry=true){
    const generation=epoch;
    try{return await transport({target:'cloud',path:'/api/v1'+path,method,body,token:cloud.accessToken||''});}
    catch(e){
      if(e.status===401&&retry&&cloud.refreshToken){
        if(!refreshing)refreshing=transport({target:'cloud',path:'/api/v1/auth/refresh',method:'POST',body:{refreshToken:cloud.refreshToken}}).then(tokens=>{if(epoch!==generation)throw Error('账号已切换');cloud={...cloud,...tokens};persist();}).finally(()=>refreshing=null);
        await refreshing;if(epoch!==generation)throw Error('账号已切换');return api(path,method,body,false);
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
    $('dialog-body').insertAdjacentHTML('afterbegin','<button class="setting-action" id="account-settings">'+(cloud.user?'账号与同步':'注册 / 登录')+'<small>'+(cloud.user?esc(cloud.user.nickname)+' · '+esc(syncStatus):'按需联网，跨设备恢复课表和私人待办')+'</small></button><button class="setting-action" id="ai-settings">AI 助手设置<small>DeepSeek / Qwen · Key 仅保存在此设备</small></button>');
    $('account-settings').onclick=accountSettings;$('ai-settings').onclick=aiSettings;
    document.querySelector('.version').textContent='星课表 2.0.0-beta.2 · 内测版';
    const hints=$('dialog-body').querySelectorAll('.hint');if(hints.length)hints[0].textContent='不登录也能离线使用。登录后课表、作息和私人待办同步到你的服务器；待办不会向搭子公开。AI Key、照片和聊天不进入备份或云同步。';
  };
  function accountSettings(){
    if(!cloud.user){loginForm();return;}
    showModal('账号与同步','<div class="account-banner"><strong>'+esc(cloud.user.nickname)+'</strong><small>用户 ID：'+esc(cloud.user.userId)+'</small><small>'+esc(syncStatus)+'</small></div><p class="hint">服务器：'+esc(cloud.baseUrl)+'<br>当前数据属于此账号；退出后恢复未登录时的本机数据。待办仅本人可读取。</p><button id="cloud-sync" class="setting-action">立即同步 / 处理冲突</button><button id="cloud-partner" class="setting-action">管理在线搭子</button><button id="cloud-logout" class="setting-action">退出登录</button>');
    $('cloud-sync').onclick=()=>sync(true);$('cloud-partner').onclick=window.openOnlinePartner;
    $('cloud-logout').onclick=()=>{
      showModal('退出登录？','<p class="hint">账号数据仍保留在本机独立空间，退出后显示访客数据。'+(isDirty()?'你还有未同步修改，请先导出备份或同步。':'')+'</p><button id="logout-export" class="setting-action">导出当前备份</button><button id="logout-confirm" class="danger">退出并恢复访客数据</button>');
      $('logout-export').onclick=exportData;$('logout-confirm').onclick=async()=>{if(syncing)return notify('正在同步，请稍后');$('logout-confirm').disabled=true;let revoked=true;try{await api('/auth/logout','POST',{});}catch(e){revoked=false;}try{const guest=cached('guest');activate({baseUrl:cloud.baseUrl},guest?JSON.parse(guest):C.defaults(),'guest');closeModal();syncStatus='离线可用';notify(revoked?'已退出，恢复访客数据':'已本地退出；离线会话将在服务器到期失效');}catch(e){notify(e.message);}};
    };
  }
  function loginForm(){
    showModal('注册 / 登录','<p class="hint">登录不是必选项。你的课表、作息和私人待办会存到此服务器；仅向搭子共享课表和作息。</p><form id="login-form"><label>API 服务器（HTTPS）<input id="server-url" type="url" required placeholder="https://api.example.com" value="'+esc(cloud.baseUrl||'')+'"></label><label>用户名<input id="login-name" autocomplete="username" required pattern="[a-zA-Z0-9_]{3,32}" placeholder="3–32 位字母、数字或下划线"></label><label>密码<input id="login-password" type="password" autocomplete="current-password" required minlength="10" maxlength="128" placeholder="至少 10 位，请妥善保存"></label><label>昵称（注册时填写）<input id="login-nickname" maxlength="30"></label><p class="hint">此个人服务暂不提供找回密码，请保存好你的账号和密码。</p><div class="error" id="login-error"></div><div class="cloud-actions"><button class="primary" id="login-submit" type="submit">登录</button><button class="secondary" id="register-submit" type="button">注册</button></div></form>');
    const submit=async register=>{
      if(!$('login-form').reportValidity())return;
      const error=$('login-error'),buttons=[$('login-submit'),$('register-submit')];buttons.forEach(x=>x.disabled=true);
      try{
        const baseUrl=validBase($('server-url').value.trim()),body={username:$('login-name').value.trim(),password:$('login-password').value};
        if(register){body.nickname=$('login-nickname').value.trim();if(!body.nickname)throw Error('注册时请填写昵称');}
        cloud={baseUrl};persist();
        const tokens=await api(register?'/auth/register':'/auth/login','POST',body,false);
        const candidate={baseUrl,...tokens};
        const remote=await transport({target:'cloud',path:'/api/v1/me/data',method:'GET',token:tokens.accessToken});
        selectInitial(candidate,remote);
      }catch(e){error.textContent=e.message;}finally{buttons.forEach(x=>x.disabled=false);}
    };
    $('login-form').onsubmit=e=>{e.preventDefault();submit(false);};$('register-submit').onclick=()=>submit(true);
  }
  function selectInitial(candidate,remote){
    const target=accountScope(candidate),stored=cached(target),local=stored?C.validate(JSON.parse(stored)):(scope==='guest'?C.validate(state):C.defaults());
    const localLabel=stored?'此账号的本机副本':'当前访客数据';
    showModal('选择首次同步方向','<p class="hint">'+localLabel+'：'+summary(local)+'<br>云端：'+summary(remote.document)+'</p><p class="hint">不自动合并或覆盖。访客原始数据会保留在独立空间，退出登录后可恢复。</p><button id="use-cloud" class="setting-action">'+(remote.document?'使用云端数据':'以空白账号开始')+'</button><button id="use-local" class="setting-action">将'+localLabel+'同步到这个账号</button>');
    const choose=useLocal=>{try{const doc=useLocal?local:(remote.document||C.defaults());activate({...candidate,revision:remote.revision,synced:remote.document?JSON.stringify(C.validate(remote.document)):null},doc,target);closeModal();syncStatus='待同步';sync(true);}catch(e){notify(e.message);}};
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
    showModal('AI 助手设置','<form id="ai-config-form"><p class="hint">直接连接模型服务商，无需星课表账号。API 用量由服务商计费；Key 使用 Android 系统密钥加密，不会上传到课表服务器。</p><label>服务商<select id="ai-provider"><option value="deepseek">DeepSeek</option><option value="qwen">Qwen（通义千问）</option></select></label><label>API Base URL<input id="ai-base" type="url" required value="'+esc(config.baseUrl||defaults[provider].baseUrl)+'"></label><label>模型名称<input id="ai-model" required maxlength="100" value="'+esc(config.model||defaults[provider].model)+'"></label><label>API Key<input id="ai-key" type="password" autocomplete="off" maxlength="1000" placeholder="'+(config.key?'已保存；留空保持原 Key':'填写个人 API Key')+'"></label><p class="hint">Qwen 的 Key 与地域须匹配；可填写官方业务空间专属域名。选图后使用支持视觉的模型。发送前请核对勾选的数据范围。</p><div class="cloud-actions"><button type="button" id="ai-key-delete" class="danger">删除 Key</button><button class="primary">保存配置</button></div></form>');
    $('ai-provider').value=provider;$('ai-provider').onchange=()=>{const d=defaults[$('ai-provider').value];$('ai-base').value=d.baseUrl;$('ai-model').value=d.model;$('ai-key').value='';$('ai-key').placeholder='服务商已切换，请填写对应 Key';};
    $('ai-config-form').onsubmit=e=>{e.preventDefault();try{const p=$('ai-provider').value,key=$('ai-key').value.trim()||(p===provider?config.key:'');if(!key)throw Error('请填写 API Key');const url=new URL($('ai-base').value.trim());if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('请填写有效 HTTPS 官方地址');write('ai',{provider:p,key,baseUrl:url.href.replace(/\/$/,''),model:$('ai-model').value.trim()});closeModal();notify(native?'AI 配置已加密保存':'浏览器预览不支持联网；Key 未持久保存');}catch(err){notify(err.message);}};
    $('ai-key-delete').onclick=()=>{write('ai',{});closeModal();notify('Key 已删除');};
  }
  function message(text,role='assistant'){const el=document.createElement('div');el.className='ai-message '+role;el.textContent=text;$('ai-messages').appendChild(el);el.scrollIntoView({block:'end'});return el;}
  function openAI(){closeModal();$('ai-panel').hidden=false;document.body.style.overflow='hidden';if(!$('ai-messages').children.length)message('你好，我是星小助。可以聊聊学习计划，也能生成课表和待办修改建议。所有修改都需要你预览并确认。');$('ai-input').focus();}
  function closeAI(){$('ai-panel').hidden=true;document.body.style.overflow='';$('ai-fab').focus();}
  $('ai-close').onclick=closeAI;$('ai-config').onclick=aiSettings;
  const oldBack=window.handleBack;window.handleBack=()=>{if(!$('modal').hidden)return oldBack();if(!$('ai-panel').hidden){closeAI();return true;}return oldBack();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('modal').hidden&&!$('ai-panel').hidden)closeAI();});
  window.receiveAIPhoto=data=>{photo=data;$('ai-photo').src=data;$('ai-photo-preview').hidden=false;if(!$('ai-input').value)$('ai-input').value='请识别照片中的课表，生成课表和作息修改建议。不确定的文字和节次请列出，不要猜测。';};
  $('ai-upload').onclick=()=>native?Online.pickPhoto(false):notify('请在安卓应用中选择照片');$('ai-camera').onclick=()=>native?Online.pickPhoto(true):notify('请在安卓应用中拍照');
  $('ai-photo-remove').onclick=()=>{photo=null;$('ai-photo').removeAttribute('src');$('ai-photo-preview').hidden=true;};
  ['ai-context-schedule','ai-context-todos'].forEach(id=>$(id).onchange=()=>{history=[];});
  $('ai-clear').onclick=()=>{if(aiBusy)return notify('请等待当前请求完成');history=[];$('ai-messages').replaceChildren();$('ai-photo-remove').click();};
  function readable(value,slots){
    if(!value)return '无';
    if(value.slots)return '作息：'+value.slots.map(s=>(s.label||s.id)+' '+s.start+'–'+s.end).join('；')+'\n课程：\n'+(value.courses.map(c=>readable(c,value.slots)).join('\n')||'空白课表');
    if(value.title)return value.title+'\n时间：'+new Date(value.dueAt).toLocaleString()+'\n优先级：'+({low:'低',normal:'普通',high:'高'})[value.priority]+' · '+(value.completed?'已完成':'未完成')+' · '+(value.remind?'提醒':'不提醒')+(value.note?'\n备注：'+value.note:'');
    const start=slots.find(s=>s.id===value.start),end=slots.find(s=>s.id===value.end);
    return value.name+' · 周'+DAYS[value.day-1]+' '+(start?start.start:value.start)+'–'+(end?end.end:value.end)+(value.room?' · '+value.room:'')+(value.note?'\n备注：'+value.note:'');
  }
  function preview(result,base,generation){
    showModal('确认 AI 修改','<p class="hint">'+esc(result.message)+'</p>'+(result.warnings.length?'<p class="danger-note">请核对不确定信息：<br>'+result.warnings.map(esc).join('<br>')+'</p>':'')+result.changes.map(change=>'<div class="diff-card"><strong>'+esc(change.type)+'</strong><p class="hint">修改前</p><pre>'+esc(readable(change.before,JSON.parse(base).slots))+'</pre><p class="hint">修改后</p><pre>'+esc(readable(change.after,result.next.slots))+'</pre><details><summary>查看配置 JSON</summary><pre>'+esc(JSON.stringify(change,null,2))+'</pre></details></div>').join('')+'<p class="hint">确认后写入“我的课表 / 私人待办”，已登录时也会同步。不会修改搭子的课表。</p><div class="cloud-actions"><button id="ai-cancel" class="secondary">取消</button><button id="ai-apply" class="primary">确认全部修改</button></div>');
    $('ai-cancel').onclick=closeModal;$('ai-apply').onclick=()=>{try{if(generation!==epoch||rawState()!==base)throw Error('数据或账号已变化，这份建议已失效，请重新生成');save(result.next);closeModal();message('你已确认，修改已保存。');notify('AI 修改已应用');}catch(e){notify(e.message);}};
  }
  $('ai-form').onsubmit=async e=>{
    e.preventDefault();if(aiBusy)return;
    const config=native?read('ai'):memoryAI;if(!config.key){aiSettings();return;}
    const prompt=$('ai-input').value.trim();if(!prompt)return;
    const base=rawState(),generation=epoch,permissions={schedule:$('ai-context-schedule').checked,todos:$('ai-context-todos').checked};
    const context={version:2,now:Date.now(),localTime:new Date().toString()};if(permissions.schedule){context.slots=state.slots;context.courses=state.courses;}if(permissions.todos)context.todos=state.todos;
    const system='你是星课表助手。仅输出 JSON 对象：{"message":"中文回答","warnings":["不确定信息"],"operations":[]}。聊天时 operations 为空。所有操作都是等待用户确认的建议，不要宣称已执行。只使用用户授权提供的数据。不确定的图片文字不得编造。支持 type: course.create/course.update/course.delete/todo.create/todo.update/todo.delete（字段 id，value 不含 id）；新记录生成唯一字符串 id，update 只列变化字段。course value 包含 day(1-7),start/end(时间段id),name,color(#rrggbb),room,note；todo value 包含 title,dueAt(毫秒),createdAt(毫秒),priority(low/normal/high),note,completed,remind。更换作息或整张课表只允许 schedule.replace，带完整 slots 和 courses 数组（课程含 id），保留待办。slots 包含 id,start/end(HH:mm)，活动段可含 kind:activity,label。时间不重叠，课程不冲突。课程与待办字段长度限制分别遵循名称30/标题80/地点60/备注500。当前授权上下文 JSON：'+JSON.stringify(context);
    const content=photo?[{type:'text',text:prompt},{type:'image_url',image_url:{url:photo}}]:prompt;
    message(prompt+(photo?'\n[已附课表照片]':''),'user');$('ai-input').value='';aiBusy=true;$('ai-send').disabled=true;const waiting=message('正在思考，请稍候……');
    try{
      // Conversation contains only user prompts / answers, not prior private contexts or images.
      const contract='补充协议：权限为 '+JSON.stringify(permissions)+'。未授权的类型不得生成操作，请在 message 中提示勾选对应权限。create 不需要 id，由客户端生成；update/delete 的 id 必须来自上下文已有记录。待办 dueAt 优先使用带时区的 ISO 8601 日期时间，例如 2026-10-04T09:00:00+08:00，禁止秒时间戳。用户未指定具体时刻时先询问，不生成待办。缺省 priority=normal、completed=false、remind=false、note=""，只有明确要求提醒才设置 remind=true。操作示例：{"message":"请预览确认","warnings":[],"operations":[{"type":"todo.create","value":{"title":"喝一杯牛奶","dueAt":"2026-10-04T09:00:00+08:00"}}]}。示例时间仅展示格式，实际日期根据当前时间和用户要求计算。';
      const messages=[{role:'system',content:system+'\n'+contract},...history.slice(-8),{role:'user',content}];
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
  if(cloud.user&&!loadingError)setTimeout(()=>sync(),500);
})();
