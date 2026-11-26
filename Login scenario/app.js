// Browser-local prototype. No credentials, email or organization data leave the page.
const $ = id => document.getElementById(id);
const view = $('view'), dialog = $('dialog');
const icons = Object.fromEntries([...document.querySelectorAll('[data-icon]')].map(el => [el.dataset.icon, el.src]));
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name, busy = false) => '<img alt="" class="icon' + (busy ? ' busy' : '') + '" src="' + icons[name] + '">';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const uid = () => [...crypto.getRandomValues(new Uint32Array(3))].join('-');
const MIN = 60000;
const storageKey = 'mavam.login.v2';
function read(store, key, fallback) {
  try { return JSON.parse(window[store].getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(store, key, value) {
  try { window[store].setItem(key, JSON.stringify(value)); } catch { /* Private mode keeps this visit in memory. */ }
}
const blankDraft = () => ({name:'',slug:'',manual:false,id:uid()});
function fresh(){
  let remembered='';
  try {remembered=localStorage.getItem('ai4msme.remembered')||'';}catch{}
  return {page:'login',identity:remembered,remember:Boolean(remembered),challenge:null,until:0,draft:null,selected:null,profile:'sample',fault:'',sends:[]};
}
let state = {...fresh(), ...read('sessionStorage',storageKey,{})};
function save(){write('sessionStorage',storageKey,state);}
function setRemember(){
  try {if(state.remember)localStorage.setItem('ai4msme.remembered',state.identity);else localStorage.removeItem('ai4msme.remembered');}catch{}
}
const owner = () => state.identity.trim().toLowerCase();
const accountKey = () => state.profile + ':' + owner();
const sample = {name:'Rina’s Glow Skincare',slug:'rinas-glow',role:'Owner'};
const second = {name:'Santoso Studio',slug:'santoso-studio',role:'Member'};
const systemSlugs = new Set(['admin','api','support','login','logout','settings','new','org','www','help']);
let records = [], database;
function db(){
  if(!database) database=new Promise((resolve,reject)=>{
    const req=indexedDB.open('mavam-demo-organizations-v2',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('organizations',{keyPath:'slug'});
    req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();database=null;};resolve(db);};
    req.onerror=()=>reject(req.error);
  }).catch(error=>{database=null;throw error;});
  return database;
}
async function allRecords(){
  const database=await db();
  return new Promise((resolve,reject)=>{const req=database.transaction('organizations').objectStore('organizations').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
async function insertOrganization(org){
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('organizations','readwrite'), table=tx.objectStore('organizations');
    const req=table.get(org.slug);
    req.onsuccess=()=>{const existing=req.result;if(!existing)table.add(org);else if(existing.id!==org.id || existing.account!==org.account)tx.abort();};
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new DOMException('Address taken','ConstraintError'));
  });
}
function businesses(){
  const fixtures=state.profile==='empty'?[]:state.profile==='multi'?[sample,second]:[sample];
  return [...fixtures,...records.filter(row=>row.account===accountKey())];
}
function taken(slug){
  return [sample.slug,second.slug].includes(slug)||records.some(o=>o.slug===slug && (o.id!==state.draft?.id||o.account!==accountKey()));
}
let revision=0,timer=0,busy=false;
const secured=new Set(['choose','create','success','workspace']);
function navigate(page){
  if(history.state?.mavamPage!==page){
    try{history.pushState({mavamPage:page},'');}catch{}
  }
  state.page=page;save();render();
}
window.addEventListener('popstate',event=>{
  const target=event.state?.mavamPage;
  if(!target)return;
  if(busy){history.pushState({mavamPage:state.page},'');return;}
  if(secured.has(target)){
    state.page=state.until>Date.now()?(target==='create' && !state.draft?'choose':target):'login';
  }else if(state.until>Date.now()){state.page='choose';}
  else{state.page=target==='verify'&&state.challenge?'verify':'login';}
  save();render();
});
function expire(){
  state.until=0;state.challenge=null;state.selected=null;state.page='expired';save();render();
}
function mount(title,intro,body,step,alert=false){
  document.title=title+' · Mavam';
  [...$('steps').children].forEach((el,i)=>{if(i===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
  view.innerHTML='<h1 tabindex="-1">'+h(title)+'</h1><p id="screenIntro" class="intro'+(alert?' error':'')+'"'+(alert?' role="alert"':'')+'>'+intro+'</p>'+body;
  view.querySelector('h1').focus({preventScroll:true});
}
function modal(title,html){
  $('dialogBody').innerHTML='<h2 id="dialogTitle">'+h(title)+'</h2>'+html;
  if(!dialog.open)dialog.showModal();
}
function closeModal(){if(dialog.open)dialog.close();}
function render(){
  revision++;clearInterval(timer);busy=false;closeModal();
  if(secured.has(state.page)&&Date.now()>=state.until){expire();return;}
  switch(state.page){
    case 'verify': if(state.challenge){verify();break;} navigate('login');break;
    case 'choose': choose();break;
    case 'create': prepareCreate();break;
    case 'success': case 'workspace': if(state.selected)result();else navigate('choose');break;
    case 'expired': mount('Session expired','Sign in again to continue. Your organization draft is saved for this account.','<button id="again" class="primary">Sign in again</button>',0,true);$('again').onclick=()=>navigate('login');break;
    default: login();
  }
}
function fault(name){if(state.fault!==name)return false;state.fault='';save();return true;}
function signOut(){
  const id=state.remember?state.identity:'',remember=state.remember;
  state={...fresh(),identity:id,remember};navigate('login');
}
function completeAuth(){
  state.challenge=null;state.until=Date.now()+30*MIN;
  if(state.draft && state.draft.account!==accountKey())state.draft=null;
  navigate(state.draft?.account===accountKey()?'create':'choose');
}
function newCode(){
  const previous=state.challenge?.code;
  let code;
  do {code=String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);}while(code===previous);
  state.challenge={code,issued:Date.now(),attempts:0,wrong:false};
  state.sends.push(Date.now());save();
}
function sendLimit(){
  state.sends=state.sends.filter(time=>time>Date.now()-10*MIN);
  return state.sends.length>=5?Math.ceil((state.sends[0]+10*MIN-Date.now())/1000):0;
}
function login(){
  mount('Welcome back','Sign in to your Mavam workspace',`
  <form id="login" novalidate><label for="identity">Email or username</label><div class="field">${icon('email')}<input id="identity" value="${h(state.identity)}" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="loginMsg" placeholder="example@email.com"></div>
  <p id="loginMsg" class="msg error" role="alert"></p><div class="stack"><button class="primary" id="send">Continue</button><button class="secondary" type="button" id="passkey">${icon('passkey')}Sign in with Passkey</button></div>
  <label class="check"><input type="checkbox" id="remember" ${state.remember?'checked':''}>Remember me</label></form>`,0);
  const input=$('identity'),msg=$('loginMsg');
  const identityError=()=>{
    const id=input.value.trim();
    if(!id)return 'Enter your email address or username.';
    if(id.length>254)return 'Use 254 characters or fewer.';
    if(id.includes('@'))return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)?'':'Enter a complete email address, such as name@example.com.';
    return /^[\p{L}\p{N}_.-]+$/u.test(id)?'':'Use a username without spaces, or enter an email address.';
  };
  function capture(){state.identity=input.value.trim();state.remember=$('remember').checked;save();}
  input.oninput=()=>{input.removeAttribute('aria-invalid');msg.textContent='';capture();};
  $('remember').onchange=capture;
  $('login').onsubmit=async event=>{
    event.preventDefault();if(busy)return;capture();
    const error=identityError();if(error){msg.textContent=error;input.setAttribute('aria-invalid','true');input.focus();return;}
    if(sendLimit()){msg.textContent='Too many code requests. Try again in '+Math.ceil(sendLimit()/60)+' min.';return;}
    const rev=revision;busy=true;input.readOnly=true;$('send').disabled=true;$('passkey').disabled=true;$('send').textContent='Sending code…';await delay(400);
    if(rev!==revision)return;
    if(state.fault==='offline'){fault('offline');busy=false;input.readOnly=false;$('send').disabled=false;$('passkey').disabled=false;$('send').textContent='Try again';msg.textContent='You’re offline. Reconnect and try again. In this demo the next attempt restores the connection.';return;}
    if(fault('send')||fault('unavailable')){busy=false;input.readOnly=false;$('send').disabled=false;$('passkey').disabled=false;$('send').textContent='Try again';msg.textContent='We couldn’t send a code. Check the account details or try again.';return;}
    setRemember();newCode();navigate('verify');
  };
  $('passkey').onclick=()=>{
    capture();if(input.value.trim()&&identityError()){msg.textContent=identityError();input.focus();return;}
    const outcomes={keyMissing:'No matching passkey was found on this device.',keyUnsupported:'This browser does not support passkeys.',keyCancelled:'The passkey request was cancelled.',keyTimeout:'The passkey request timed out.'};
    if(outcomes[state.fault]){msg.textContent=outcomes[state.fault]+' Try again or continue with an email code.';state.fault='';save();return;}
    modal('Sign in with Passkey','<p>This preview simulates your device prompt for <strong>'+h(state.identity||'demo@mavam.example')+'</strong>.</p><div class="dialog-actions"><button id="keyOk" class="primary">Use demo passkey</button><button id="keyCancel" class="secondary">Cancel</button></div>');
    $('keyOk').onclick=()=>{if(!state.identity)state.identity='demo@mavam.example';setRemember();completeAuth();};
    $('keyCancel').onclick=()=>{closeModal();msg.textContent='Passkey sign-in cancelled. Try again or use an email code.';};
  };
}
function codeState(){
  if(Date.now()>=state.challenge.issued+10*MIN)return 'expired';
  if(state.challenge.attempts>=5)return 'locked';
  return state.challenge.wrong?'wrong':'ready';
}
function verify(){
  const c=state.challenge,mode=codeState(),id=h(state.identity);
  const copy={
    expired:['Code expired','Your code for <strong>'+id+'</strong> has expired. Request a new code to continue.'],
    locked:['Request a new code','Too many incorrect attempts. Get a new code to continue.'],
    wrong:['Check your code','Incorrect code for <strong>'+id+'</strong>. Try again or request a new code.'],
    ready:['Check your email','Enter the 6-digit code for <strong>'+id+'</strong>. It expires in 10 minutes.']
  }[mode];
  const blocked=['expired','locked'].includes(mode);
  mount(copy[0],copy[1],`<form id="verify" novalidate><label for="code">Code</label><div class="otp"><div class="digits" aria-hidden="true">${'<span></span>'.repeat(6)}</div><input id="code" inputmode="numeric" autocomplete="one-time-code" aria-describedby="screenIntro codeMsg demoCode" aria-label="6-digit code" ${blocked?'disabled':''}></div><p class="msg error" id="codeMsg" role="alert"></p><div class="stack"><button id="check" class="primary" disabled>Continue</button><button type="button" id="resend" class="secondary"></button></div></form><button class="quiet return" id="change">Change account</button><p id="demoCode" class="preview-hint">${blocked?'Demo · Email delivery is simulated.':'Demo code <b>'+c.code+'</b> · No email is sent.'}</p>`,1,mode!=='ready');
  const input=$('code'),slots=[...view.querySelectorAll('.digits span')];
  if(mode==='wrong' && c.lastAttempt){
    input.value=c.lastAttempt;
    input.setAttribute('aria-invalid','true');
  }
  function paint(){
    slots.forEach((slot,i)=>{slot.textContent=input.value[i]||'';slot.classList.toggle('current',i===Math.min(input.selectionStart??input.value.length,5));});
    $('check').disabled=busy||blocked||input.value.length!==6||(c.wrong && input.value===c.lastAttempt);
  }
  input.oninput=()=>{input.value=input.value.replace(/[^0-9]/g,'').slice(0,6);input.removeAttribute('aria-invalid');$('codeMsg').textContent='';paint();};
  input.onkeyup=input.onclick=paint;
  function tick(){
    if(codeState()==='expired' && mode!=='expired'){render();return;}
    const wait=Math.max(sendLimit(),blocked?0:Math.ceil((c.issued+30000-Date.now())/1000),0);
    $('resend').disabled=busy||wait>0;
    $('resend').innerHTML=icon('resend')+(wait?'Resend code in '+wait+' s':blocked?'Send a new code':'Resend code');
  }
  paint();tick();timer=setInterval(tick,500);
  $('resend').onclick=async()=>{
    if(busy||$('resend').disabled)return;
    const rev=revision;busy=true;paint();tick();await delay(350);
    if(rev!==revision)return;
    busy=false;
    if(fault('resend')){$('codeMsg').textContent='The new code could not be sent. Try again.';paint();tick();return;}
    newCode();render();$('code').focus();
  };
  $('change').onclick=()=>{state.challenge=null;navigate('login');};
  $('verify').onsubmit=async event=>{
    event.preventDefault();if($('check').disabled)return;
    const rev=revision,value=input.value;busy=true;input.readOnly=true;paint();tick();$('check').textContent='Verifying…';await delay(350);
    if(rev!==revision)return;
    if(codeState()==='expired'){render();return;}
    if(fault('verify')){busy=false;input.readOnly=false;paint();tick();$('check').textContent='Try again';$('codeMsg').textContent='Verification is temporarily unavailable. Try again with the same code.';return;}
    if(value!==c.code){c.attempts++;c.wrong=true;c.lastAttempt=value;save();render();if(!$('code').disabled){$('code').focus();$('code').select();}return;}
    completeAuth();
  };
}
async function loadDirectory(next){
  const rev=revision;
  mount('Your businesses','Loading organizations…','',2);
  try {
    if(fault('directory'))throw new Error('Simulated unavailable directory');
    records=await allRecords();
    if(rev===revision)next();
  }catch{
    if(rev!==revision)return;
    mount('Businesses unavailable','We couldn’t read the demo directory. Allow browser storage, then try again.','<button class="primary" id="retry">Try again</button><button class="quiet return" id="exit">Sign out</button>',2,true);
    $('retry').onclick=render;$('exit').onclick=signOut;
  }
}
function choose(){loadDirectory(()=>{
  const list=businesses();
  mount(list.length?'Choose a business':'Create your first organization',list.length?'Pick the business you want to open, or create a new one.':'Your account has no businesses yet. Create one to open your workspace.',
    list.map((org,i)=>'<button class="business" data-business="'+i+'"><span class="avatar">'+h(org.name.split(/\s+/).map(x=>x[0]).slice(0,2).join(''))+'</span><span class="grow"><strong>'+h(org.name)+'</strong><small>/org/'+h(org.slug)+'</small></span>'+icon('open')+'</button>').join('')+
    '<div class="stack compact"><button id="add" class="'+(list.length?'secondary':'primary')+'">'+icon('plus')+(state.draft?'Continue organization draft':'Add new organization')+'</button></div><p id="accessMsg" class="msg error" role="alert"></p><button id="exit" class="quiet return">Sign out</button>',2);
  view.querySelectorAll('[data-business]').forEach(button=>button.onclick=()=>{
    if(fault('access')){$('accessMsg').textContent='Access to this business is unavailable. Choose another business or contact its owner.';button.disabled=true;return;}
    state.selected=list[Number(button.dataset.business)];navigate('workspace');
  });
  $('add').onclick=()=>navigate('create');$('exit').onclick=signOut;
});}
function prepareCreate(){
  if(!state.draft || state.draft.account!==accountKey())state.draft={...blankDraft(),account:accountKey()};
  save();loadDirectory(()=>{
    const committed=records.find(org=>org.id===state.draft.id && org.account===accountKey());
    if(committed){state.selected=committed;state.draft=null;navigate('success');}
    else createForm();
  });
}
function defaultSlug(name){
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,63).replace(/^-|-$/g,'');
}
function slugIssue(slug){
  if(!slug)return 'Enter a web address.';
  if(slug.length>63)return 'Use 63 characters or fewer.';
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return 'Use a–z, 0–9 and single hyphens.';
  if(systemSlugs.has(slug))return 'This address is reserved.';
  if(taken(slug))return 'This web address is already taken.';
  return '';
}
function suggest(slug){
  for(let i=2;;i++){const suffix='-'+i,base=slug.slice(0,63-suffix.length).replace(/-$/,'');if(!slugIssue(base+suffix))return base+suffix;}
}
function createForm(failed=false, conflictingAddress=false){
  const d=state.draft;
  mount('Create organization','Give your business a name and web address. You’ll become its Owner.',`
    <form id="create" novalidate><label for="name">Organization name</label><div class="field"><input id="name" value="${h(d.name)}" autocomplete="organization" aria-describedby="nameHint"></div><p id="nameHint" class="field-help" role="status">You can change the name later.</p>
    <label class="fieldrow" for="slug">Web address</label><div class="field"><span class="prefix">/org/</span><input id="slug" value="${h(d.slug)}" autocapitalize="none" spellcheck="false" aria-describedby="addressMsg warning"></div>
    <div class="address-help"><p id="addressMsg" class="field-help" role="status">Choose a unique address for your business.</p><button type="button" id="suggest" hidden>Use suggestion</button></div>
    <p class="note" id="warning">${icon('notice')}Your web address is permanent. It appears in the links you share and can’t be changed later.</p>
    <p class="msg error" id="createMsg" role="alert">${failed?'Nothing was created. Your details are saved here. Check your connection and try again.':''}</p>
    <div class="stack"><button class="primary" id="save">${failed?'Try again':'Create organization'}</button><button class="secondary" type="button" id="back">${icon('back')}Back to your businesses</button></div></form>`,2);
  const name=$('name'),slug=$('slug'),addressMsg=$('addressMsg'),suggestion=$('suggest'),submit=$('save');
  const nameHelp=$('nameHint');
  const nameHint=nameHelp.textContent, addressHint=addressMsg.textContent;
  function feedback(input,helper,text,status=''){
    helper.textContent=text;
    helper.className=('field-help '+status).trim();
    if(status==='error')input.setAttribute('aria-invalid','true');
    else input.removeAttribute('aria-invalid');
  }
  function showAddressResult(issue, conflict=false){
    feedback(slug,addressMsg,issue||'This address is available.',issue?'error':'ok');
    if(conflict||taken(d.slug)||systemSlugs.has(d.slug)){
      const alternative=suggest(d.slug);
      suggestion.hidden=false;
      suggestion.title='Use /org/'+alternative;
      suggestion.onclick=()=>{slug.value=alternative;slug.dispatchEvent(new Event('input'));slug.focus();};
    }else suggestion.hidden=true;
  }
  function edit(fromName){
    const previousSlug=d.slug;
    d.name=name.value;
    if(fromName){
      feedback(name,nameHelp,nameHint);
      if(!d.manual)slug.value=defaultSlug(d.name);
    }else d.manual=true;
    d.slug=slug.value;
    if(d.slug!==previousSlug){
      feedback(slug,addressMsg,addressHint);
      suggestion.hidden=true;
    }
    save();$('createMsg').textContent='';submit.textContent='Create organization';
  }
  name.oninput=()=>edit(true);
  slug.oninput=()=>edit(false);
  $('back').onclick=()=>{if(!d.name&&!d.slug)state.draft=null;navigate('choose');};
  if(conflictingAddress){showAddressResult('This web address is already taken.',true);slug.focus();}
  $('create').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    if(Date.now()>=state.until){expire();return;}
    const rev=revision;
    const wasReadOnly=name.readOnly;
    busy=true;submit.disabled=true;name.readOnly=true;slug.readOnly=true;$('back').disabled=true;suggestion.hidden=true;
    try{
      records=await allRecords();
    }catch{
      if(revision!==rev)return;
      busy=false;submit.disabled=false;name.readOnly=wasReadOnly;slug.readOnly=wasReadOnly;$('back').disabled=false;
      $('createMsg').textContent='We couldn’t check this address. Please try again.';
      return;
    }
    if(revision!==rev)return;
    const nameIssue=!d.name.trim()?'Enter the organization name.':d.name.trim().length>100?'Use 100 characters or fewer.':'';
    const addressIssue=slugIssue(d.slug);
    feedback(name,nameHelp,nameIssue||nameHint,nameIssue?'error':'');
    showAddressResult(addressIssue);
    if(nameIssue||addressIssue){
      busy=false;name.readOnly=wasReadOnly;slug.readOnly=wasReadOnly;submit.disabled=false;$('back').disabled=false;
      (nameIssue?name:slug).focus();return;
    }
    view.querySelector('h1').textContent='Creating organization';
    view.querySelector('.intro').textContent='We’re setting up '+d.name.trim()+'. Please keep this page open.';
    submit.innerHTML=icon('spinner',true)+'Creating organization…';
    const org={name:d.name.trim(),slug:d.slug,account:accountKey(),id:d.id,role:'Owner'};
    await delay(650);if(rev!==revision)return;
    if(Date.now()>=state.until){expire();return;}
    try{
      if(fault('create'))throw new Error('Simulated interruption');
      if(fault('race')){await insertOrganization({...org,name:'Another business',account:'reserved',id:uid()});}
      await insertOrganization(org);
      if(rev!==revision)return;
      if(fault('responseLost')){
        busy=false;createForm(true);
        $('name').readOnly=true;$('slug').readOnly=true;
        $('createMsg').textContent='The confirmation timed out. Try again to check whether the organization was created.';
        return;
      }
      state.selected=org;state.draft=null;navigate('success');
    }catch(error){
      if(rev!==revision)return;
      busy=false;
      if(error.name==='ConstraintError')createForm(false,true);
      else createForm(true);
    }
  };
}
function result(){
  const org=state.selected,created=state.page==='success';
  mount(created?'You’re all set':org.name,created?h(org.name)+' is ready. You’re its Owner. Your other organizations are unchanged.':'Your demo workspace is open.',
    '<div class="details"><strong>'+h(org.name)+'</strong><small>/org/'+h(org.slug)+'</small><small>'+h(org.role)+'</small></div><div class="stack">'+(created?'<button id="open" class="primary">Open organization</button>':'')+
    '<button class="secondary" id="list">'+icon('back')+'Back to your businesses</button></div>'+(created?'':'<button id="exit" class="quiet return">Sign out</button>'),2);
  if(created)$('open').onclick=()=>navigate('workspace');else $('exit').onclick=signOut;
  $('list').onclick=()=>navigate('choose');
}
const cases={
  'Email & passkey':[['login','Start at sign-in'],['send','Email delivery failed'],['offline','Offline, then reconnect'],['unavailable','Unknown or unavailable account'],['rate','Too many code requests'],['key','Passkey success or cancel'],['keyMissing','No registered passkey'],['keyUnsupported','Passkey unsupported'],['keyTimeout','Passkey timeout'],['keyCancelled','Passkey cancelled']],
  'Verification':[['code','New verification code'],['wrong','Incorrect code'],['expired','Expired code'],['locked','Too many incorrect attempts'],['resend','Resend failed'],['verify','Verification service unavailable']],
  'Businesses':[['single','One business'],['empty','No businesses yet'],['multi','Multiple businesses'],['directory','Business list failed'],['access','Business access revoked']],
  'Organization':[['blank','Empty form'],['ready','Available web address'],['taken','Address already taken'],['reserved','Reserved address'],['invalid','Invalid web address'],['race','Address claimed during creation'],['create','Creation failed, then retry'],['responseLost','Confirmation timed out after creation'],['session','Session expired with a draft']]
};
$('scenarios').onclick=()=>{
  if(busy)return;
  modal('Demo scenarios','<p>Explore a sample account or jump to an edge case. Code delivery and passkeys are simulated. New organizations are saved in this browser.</p><label for="case">Starting state</label><select id="case">'+Object.entries(cases).map(([g,opts])=>'<optgroup label="'+g+'">'+opts.map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</optgroup>').join('')+'</select><div class="dialog-actions"><button id="run" class="primary">Open scenario</button><button id="cancel" class="secondary">Cancel</button></div>');
  $('cancel').onclick=closeModal;$('run').onclick=()=>launch($('case').value);
};
async function launch(id){
  closeModal();
  const group=Object.keys(cases).find(g=>cases[g].some(item=>item[0]===id));
  const demoAccount='rina@rinasglow.id';
  state={...fresh(),identity:demoAccount,remember:false,profile:'sample',until:0};
  if(group==='Email & passkey'){
    if(id==='login')state.identity='';
    else if(id==='rate')state.sends=Array(5).fill(Date.now());
    else state.fault=id;
    navigate('login');return;
  }
  if(group==='Verification'){
    newCode();
    if(id==='expired')state.challenge.issued-=11*MIN;
    if(id==='locked')state.challenge.attempts=5;
    if(id==='wrong'){state.challenge.wrong=true;state.challenge.attempts=1;}
    if(id==='resend'){state.challenge.issued-=31000;state.fault=id;}
    if(id==='verify')state.fault=id;
    navigate('verify');return;
  }
  state.until=Date.now()+30*MIN;
  if(group==='Businesses'){
    if(['empty','multi'].includes(id)){state.profile=id;if(id==='empty')state.identity='new-'+uid().slice(0,8)+'@mavam.example';}
    if(['directory','access'].includes(id))state.fault=id;
    navigate('choose');return;
  }
  const draft={...blankDraft(),account:accountKey()};
  if(id!=='blank'){
    draft.name='Santoso Day Spa';draft.slug=defaultSlug(draft.name);
    // Choose an unused example on repeated previews while keeping real user drafts intact.
    try{records=await allRecords();}catch{records=[];}
    if(records.some(org=>org.slug===draft.slug))draft.slug=suggest(draft.slug);
  }
  if(id==='taken'){draft.slug=sample.slug;draft.manual=true;}
  if(id==='reserved'){draft.slug='admin';draft.manual=true;}
  if(id==='invalid'){draft.slug='Santoso--Spa';draft.manual=true;}
  if(['race','create','responseLost'].includes(id))state.fault=id;
  state.draft=draft;
  if(id==='session'){expire();return;}
  navigate('create');
}
const film = $('film');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function updateVideoPlayback() {
  film.autoplay = !reducedMotion.matches;
  if (reducedMotion.matches) film.pause();
  else film.play().catch(() => {}); // Keep the poster when autoplay is unavailable.
}
reducedMotion.addEventListener('change', updateVideoPlayback);
updateVideoPlayback();
try{history.replaceState({mavamPage:state.page},'');}catch{}
setInterval(()=>{if(secured.has(state.page)&&Date.now()>=state.until)expire();},1000);
render();
