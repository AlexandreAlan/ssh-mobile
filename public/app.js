'use strict';
/* SSH morenadoaco — cliente PWA */

const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64FromBytes(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s);}
function bytesFromB64(b64){const bin=atob(b64);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a;}

function show(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('#'+id).classList.add('active');}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200);}

async function api(method, path, body){
  const opt={method,headers:{}};
  if(body){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body);}
  const r=await fetch('/api'+path,opt);
  let data={};try{data=await r.json();}catch{}
  if(!r.ok)throw new Error(data.error||('Erro '+r.status));
  return data;
}

/* ================= AUTH ================= */
let isSetupMode=false;

async function boot(){
  try{
    const st=await api('GET','/state');
    if(st.authenticated){await openList();return;}
    isSetupMode=!st.setup;
    $('#auth-title').textContent=isSetupMode?'Crie seu acesso':'SSH morenadoaco';
    $('#auth-sub').textContent=isSetupMode?'Escolha usuário e senha. A senha criptografa todas as suas credenciais — não há recuperação, guarde bem.':'Acesso seguro aos seus servidores';
    $('#auth-user').placeholder=isSetupMode?'Novo usuário (mín. 3)':'Usuário';
    $('#auth-user').autocomplete=isSetupMode?'username':'username';
    $('#auth-pass').autocomplete=isSetupMode?'new-password':'current-password';
    $('#auth-pass').placeholder=isSetupMode?'Nova senha (mín. 8)':'Senha';
    $('#auth-pass2').style.display=isSetupMode?'block':'none';
    $('#auth-btn').textContent=isSetupMode?'Criar e entrar':'Entrar';
    show('view-auth');
  }catch(e){$('#auth-err').textContent='Servidor indisponível';show('view-auth');}
}

$('#auth-form').addEventListener('submit',async(e)=>{
  e.preventDefault();
  $('#auth-err').textContent='';
  const user=$('#auth-user').value.trim();
  const pass=$('#auth-pass').value;
  if(!user){$('#auth-err').textContent='Informe o usuário';return;}
  try{
    if(isSetupMode){
      if(pass!==$('#auth-pass2').value){$('#auth-err').textContent='As senhas não conferem';return;}
      await api('POST','/setup',{username:user,password:pass});
    }else{
      await api('POST','/login',{username:user,password:pass});
    }
    $('#auth-user').value='';$('#auth-pass').value='';$('#auth-pass2').value='';
    await openList();
  }catch(err){$('#auth-err').textContent=err.message;}
});

$('#btn-logout').addEventListener('click',async()=>{
  if(!confirm('Sair? As sessões SSH continuam ativas no servidor.'))return;
  await api('POST','/logout');location.reload();
});

/* ================= LISTA DE SERVIDORES ================= */
let servers=[];

async function openList(){
  await refreshServers();
  await refreshSessionCount();
  show('view-list');
  ensureSocket();
}

async function refreshServers(){
  const d=await api('GET','/servers');
  servers=d.servers;
  const wrap=$('#server-cards');wrap.innerHTML='';
  $('#list-empty').classList.toggle('show',servers.length===0);
  servers.forEach(s=>{
    const el=document.createElement('div');el.className='card';
    el.innerHTML=`<div class="ico">🖥️</div>
      <div class="meta"><b>${escapeHtml(s.label)}</b>
      <span>${escapeHtml(s.username)}@${escapeHtml(s.host)}:${s.port}</span></div>
      <span class="tag">${s.authType==='key'?'🔑 chave':'🔒 senha'}</span>
      <button class="edit" data-id="${s.id}">✎</button>`;
    el.addEventListener('click',(ev)=>{if(ev.target.classList.contains('edit'))return;openTerminal(s);});
    el.querySelector('.edit').addEventListener('click',()=>openEdit(s.id));
    wrap.appendChild(el);
  });
}

async function refreshSessionCount(){
  try{const d=await api('GET','/sessions');$('#sess-count').textContent=d.sessions.filter(x=>x.status!=='closed').length;}catch{}
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

$('#btn-add').addEventListener('click',()=>openEdit(null));
$('#btn-add-2').addEventListener('click',()=>openEdit(null));

/* ================= EDITOR ================= */
let editingId=null;
let editAuthType='password';

function setEditAuth(type){
  editAuthType=type;
  document.querySelectorAll('.seg button').forEach(b=>b.classList.toggle('seg-on',b.dataset.auth===type));
  $('#auth-password').style.display=type==='password'?'block':'none';
  $('#auth-key').style.display=type==='key'?'block':'none';
}
document.querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>setEditAuth(b.dataset.auth)));

function openEdit(id){
  editingId=id;$('#edit-err').textContent='';
  const s=id?servers.find(x=>x.id===id):null;
  $('#edit-title').textContent=s?'Editar servidor':'Novo servidor';
  $('#f-label').value=s?s.label:'';
  $('#f-host').value=s?s.host:'';
  $('#f-port').value=s?s.port:22;
  $('#f-user').value=s?s.username:'root';
  $('#f-password').value='';$('#f-key').value='';$('#f-passphrase').value='';
  $('#f-password').placeholder=s&&s.hasPassword?'••••••• (deixe vazio p/ manter)':'senha SSH';
  $('#f-key').placeholder=s&&s.hasKey?'(chave salva — cole nova p/ trocar)':'-----BEGIN OPENSSH PRIVATE KEY-----';
  setEditAuth(s?s.authType:'password');
  $('#btn-delete').style.display=s?'block':'none';
  show('view-edit');
}

$('#edit-back').addEventListener('click',()=>show('view-list'));

$('#edit-save').addEventListener('click',async()=>{
  $('#edit-err').textContent='';
  const payload={
    label:$('#f-label').value,host:$('#f-host').value,port:$('#f-port').value,
    username:$('#f-user').value,authType:editAuthType,
    password:$('#f-password').value,privateKey:$('#f-key').value,passphrase:$('#f-passphrase').value,
  };
  if(!payload.host){$('#edit-err').textContent='Host obrigatório';return;}
  try{
    if(editingId)await api('PUT','/servers/'+editingId,payload);
    else await api('POST','/servers',payload);
    await refreshServers();show('view-list');toast('Salvo');
  }catch(e){$('#edit-err').textContent=e.message;}
});

$('#btn-delete').addEventListener('click',async()=>{
  if(!editingId||!confirm('Excluir este servidor?'))return;
  try{await api('DELETE','/servers/'+editingId);await refreshServers();show('view-list');toast('Excluído');}
  catch(e){$('#edit-err').textContent=e.message;}
});

/* ================= SESSÕES ATIVAS ================= */
$('#btn-sessions').addEventListener('click',openSessions);
$('#sess-back').addEventListener('click',()=>show('view-list'));

async function openSessions(){
  const d=await api('GET','/sessions');
  const live=d.sessions.filter(x=>x.status!=='closed');
  const wrap=$('#session-cards');wrap.innerHTML='';
  $('#sessions-empty').classList.toggle('show',live.length===0);
  live.forEach(s=>{
    const el=document.createElement('div');el.className='card';
    const dt=new Date(s.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    el.innerHTML=`<div class="ico">⚡</div>
      <div class="meta"><b>${escapeHtml(s.label)}</b>
      <span>${escapeHtml(s.username)}@${escapeHtml(s.host)} · desde ${dt} · ${s.viewers} olhando</span></div>
      <span class="tag">${s.status}</span>
      <button class="edit" data-id="${s.id}">✕</button>`;
    el.addEventListener('click',(ev)=>{if(ev.target.classList.contains('edit'))return;reattachTerminal(s);});
    el.querySelector('.edit').addEventListener('click',async()=>{await api('POST','/sessions/'+s.id+'/close');openSessions();refreshSessionCount();});
    wrap.appendChild(el);
  });
  show('view-sessions');
}

/* ================= WEBSOCKET ================= */
let ws=null,wsReady=false;
const pending=[];

function ensureSocket(){
  if(ws&&(ws.readyState===0||ws.readyState===1))return;
  const proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen=()=>{wsReady=true;while(pending.length)ws.send(pending.shift());
    if(currentSession)wsSend({type:'attach',sessionId:currentSession});};
  ws.onclose=()=>{wsReady=false;if(term)setStatus('connecting');setTimeout(()=>{if(document.visibilityState==='visible')ensureSocket();},1500);};
  ws.onerror=()=>{};
  ws.onmessage=onWsMessage;
}

function wsSend(obj){const m=JSON.stringify(obj);if(wsReady&&ws.readyState===1)ws.send(m);else{pending.push(m);ensureSocket();}}

function onWsMessage(ev){
  let m;try{m=JSON.parse(ev.data);}catch{return;}
  switch(m.type){
    case 'opened':currentSession=m.sessionId;sendResize();break;
    case 'attached':setStatus(m.status,m.error);if(m.cols&&term&&(term.cols!==m.cols||term.rows!==m.rows)){}break;
    case 'data':if(term)term.write(bytesFromB64(m.data));break;
    case 'status':if(m.sessionId===currentSession){setStatus(m.status,m.error);if(m.status==='error')toast('Erro: '+(m.error||'conexão'));if(m.status==='closed')toast('Sessão encerrada');}break;
    case 'error':toast(m.message||'Erro');break;
  }
}

/* ================= TERMINAL ================= */
let term=null,fit=null,currentSession=null,ctrlArmed=false,altArmed=false;

function initTerm(){
  if(term)return;
  term=new Terminal({
    cursorBlink:true,fontSize:14,fontFamily:'ui-monospace,Menlo,Consolas,monospace',
    theme:{background:'#000000',foreground:'#e6ebf5',cursor:'#22d3ee'},
    scrollback:5000,allowProposedApi:true,
  });
  fit=new FitAddon.FitAddon();term.loadAddon(fit);
  term.open($('#terminal'));
  term.onData(d=>{
    if(ctrlArmed){const c=d.toLowerCase();if(c>='a'&&c<='z'){d=String.fromCharCode(c.charCodeAt(0)-96);}ctrlArmed=false;$('#k-ctrl').classList.remove('on');}
    if(altArmed){d='\x1b'+d;altArmed=false;$('#k-alt').classList.remove('on');}
    wsSend({type:'input',sessionId:currentSession,data:b64FromBytes(enc.encode(d))});
  });
  window.addEventListener('resize',()=>{if($('#view-term').classList.contains('active'))doFit();});
}

function doFit(){try{fit.fit();sendResize();}catch{}}
function sendResize(){if(term&&currentSession)wsSend({type:'resize',sessionId:currentSession,cols:term.cols,rows:term.rows});}

function setStatus(st){const d=$('#term-status');d.className='dot '+(st||'');}

function openTerminal(server){
  initTerm();currentSession=null;term.reset();
  $('#term-title').textContent=`${server.username}@${server.host}`;
  setStatus('connecting');
  show('view-term');
  setTimeout(()=>{doFit();ensureSocket();wsSend({type:'open',serverId:server.id,cols:term.cols,rows:term.rows});term.focus();},60);
}

function reattachTerminal(session){
  initTerm();currentSession=session.id;term.reset();
  $('#term-title').textContent=`${session.username}@${session.host}`;
  setStatus(session.status);
  show('view-term');
  setTimeout(()=>{doFit();ensureSocket();wsSend({type:'attach',sessionId:session.id});term.focus();},60);
}

$('#term-back').addEventListener('click',()=>{
  if(currentSession)wsSend({type:'detach',sessionId:currentSession});
  // não fecha a sessão — ela segue viva no servidor
  refreshSessionCount();show('view-list');
});

/* keybar */
$('#keybar').addEventListener('click',(e)=>{
  const b=e.target.closest('button');if(!b||!currentSession)return;
  if(b.dataset.key){
    switch(b.dataset.key){
      case 'esc':sendRaw('\x1b');break;
      case 'tab':sendRaw('\t');break;
      case 'ctrlc':sendRaw('\x03');break;
      case 'ctrld':sendRaw('\x04');break;
      case 'ctrl':ctrlArmed=!ctrlArmed;$('#k-ctrl').classList.toggle('on',ctrlArmed);term.focus();break;
      case 'alt':altArmed=!altArmed;$('#k-alt').classList.toggle('on',altArmed);term.focus();break;
    }
  }else if(b.dataset.seq){sendRaw('\x1b'+b.dataset.seq);}
  else if(b.dataset.text){sendRaw(b.dataset.text);}
});
function sendRaw(s){wsSend({type:'input',sessionId:currentSession,data:b64FromBytes(enc.encode(s))});term.focus();}

/* Reconexão ao voltar pro app (minimizado/tela bloqueada) */
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){ensureSocket();if($('#view-term').classList.contains('active'))setTimeout(doFit,200);}});
window.addEventListener('online',ensureSocket);

/* Service worker */
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

boot();
