import { demoMode, errorText, invoke, message, supabase } from '../lib/client';

type Entry={id:string;name:string;kind:'petition'|'gratitude';created_at:string;read_at:string|null;message?:string};
type Totals={petitions:number;gratitudes:number;petitions_read:number;gratitudes_read:number;intercessors:number};
const root=document.querySelector<HTMLElement>('#intercessor-app')!;
const login=root.querySelector<HTMLElement>('#intercessor-login')!;
const dashboard=root.querySelector<HTMLElement>('#intercessor-dashboard')!;
const authStatus=root.querySelector<HTMLElement>('#intercessor-auth-status');
const status=root.querySelector<HTMLElement>('#inbox-status');
const list=root.querySelector<HTMLElement>('#inbox-list')!;
const reader=root.querySelector<HTMLDialogElement>('#intention-reader')!;
const loginForm=root.querySelector<HTMLFormElement>('#intercessor-login-form')!;
const more=root.querySelector<HTMLButtonElement>('#inbox-more')!;
const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('.community-tabs [role=tab]'));
let intercessorActive=false;
let authGeneration=0;
function activateTab(id:string,focus=false) {
  if(intercessorActive) id='tab-intercessor';
  tabs.forEach(tab=>{
    const active=tab.id===id; tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    document.getElementById(tab.getAttribute('aria-controls')!)!.hidden=!active;
    if(active&&focus) tab.focus();
  });
}
function setIntercessorView(active:boolean){
  intercessorActive=active;
  document.querySelectorAll<HTMLElement>('[data-public-home]').forEach(element=>element.hidden=active);
  document.querySelectorAll<HTMLElement>('[data-intercessor-home]').forEach(element=>element.hidden=!active);
  document.querySelector<HTMLButtonElement>('#tab-intention')!.disabled=active;
  const panel=document.querySelector<HTMLElement>('#panel-intercessor')!;
  panel.setAttribute('role',active?'region':'tabpanel');
  panel.setAttribute('aria-labelledby',active?'inbox-title':'tab-intercessor');
  document.querySelector('#intenciones')!.setAttribute('aria-labelledby',active?'intercessor-title':'intentions-title');
  root.setAttribute('aria-label',active?'Bandeja de Intercesor':'Acceso de Intercesor');
  activateTab('tab-intercessor');
}
tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>activateTab(tab.id));
  tab.addEventListener('keydown',event=>{
    let next:number|undefined;
    if(event.key==='ArrowRight'||event.key==='ArrowLeft') next=(index+1)%tabs.length;
    if(event.key==='Home') next=0; if(event.key==='End') next=tabs.length-1;
    if(next!==undefined){event.preventDefault();activateTab(tabs[next].id,true);}
  });
});
function fromHash(){if(intercessorActive||location.hash==='#intercesor') activateTab('tab-intercessor');}
window.addEventListener('hashchange',fromHash);fromHash();
// Handle repeated clicks too: the hash may already be #intercesor after the
// visitor switches back to Intención. Native hashchange would not fire again.
document.querySelectorAll<HTMLAnchorElement>('a[href="/#intercesor"],a[href="#intercesor"]').forEach(link=>link.addEventListener('click',event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
  event.preventDefault();activateTab('tab-intercessor');
  if(location.hash!=='#intercesor')history.pushState(null,'','#intercesor');
  document.querySelector('#intercesor')!.scrollIntoView({block:'start'});
  root.querySelector<HTMLElement>(intercessorActive?'#inbox-title':'#intercessor-username')!.focus({preventScroll:true});
}));
const demoEntries:Entry[]=[
  {id:'demo-1',name:'María',kind:'petition',created_at:new Date().toISOString(),read_at:null,message:'Por la salud de mi familia y por quienes hoy necesitan encontrar esperanza.'},
  {id:'demo-2',name:'Un corazón agradecido',kind:'gratitude',created_at:new Date(Date.now()-3600000).toISOString(),read_at:null,message:'Gracias, María, por acompañarnos en los momentos difíciles y por las personas que nos dan una mano.'},
  {id:'demo-3',name:'Peregrino',kind:'petition',created_at:new Date(Date.now()-7200000).toISOString(),read_at:new Date(Date.now()-3600000).toISOString(),message:'Por quienes buscan trabajo, para que encuentren una oportunidad y no pierdan la confianza.'},
];
let totals:Totals={petitions:2,gratitudes:1,petitions_read:1,gratitudes_read:0,intercessors:3};
let entries:Entry[]=[]; let filter='unread'; let limit=50;let sequence=0;let opening=false;let loading=false;let entering=false;
const date=(value:string)=>new Date(value).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'});
const put=(id:string,text:string)=>{root.querySelector(id)!.textContent=text;};
function renderStats(){
  put('#stat-petitions',String(totals.petitions));put('#stat-gratitudes',String(totals.gratitudes));
  put('#stat-petitions-read',`${totals.petitions_read} leídas`);put('#stat-gratitudes-read',`${totals.gratitudes_read} leídos`);
  put('#stat-total-messages',String(Number(totals.petitions)+Number(totals.gratitudes)));put('#stat-intercessors',String(totals.intercessors));
}
function render(){
  list.replaceChildren();
  if(!entries.length){const empty=document.createElement('p');empty.className='inbox-empty';empty.textContent=filter==='unread'?'No hay mensajes sin leer. Gracias por acompañar a nuestra comunidad.':'No hay mensajes en esta selección.';list.append(empty);return;}
  entries.forEach(entry=>{
    const button=document.createElement('button');button.type='button';button.className=`inbox-item ${entry.read_at?'is-read':'is-unread'}`;
    const indicator=document.createElement('span');indicator.className='inbox-indicator';indicator.setAttribute('aria-hidden','true');indicator.textContent=entry.read_at?'○':'●';
    const info=document.createElement('span');info.className='inbox-item-info';
    const name=document.createElement('strong');name.textContent=entry.name;
    const meta=document.createElement('small');meta.textContent=`${entry.kind==='gratitude'?'Agradecimiento':'Petición'} · ${date(entry.created_at)}`;
    const state=document.createElement('span');state.className='inbox-item-state';state.textContent=entry.read_at?'Leído':'Sin leer';
    info.append(name,meta);button.append(indicator,info,state);button.addEventListener('click',()=>open(entry));list.append(button);
  });
}
async function load(quiet=false){
  const current=++sequence;loading=true;
  try {
    let unread=0;let hasMore=false;
    if(demoMode){
      const live=demoEntries.filter(e=>!e.read_at||Date.now()-Date.parse(e.read_at)<48*3600000);
      unread=live.filter(e=>!e.read_at).length;
      entries=live.filter(e=>filter==='all'||(filter==='read'?!!e.read_at:!e.read_at)).slice(0,limit);
    } else {
      let query=supabase!.from('intentions').select('id,name,kind,created_at,read_at').order('created_at',{ascending:false}).order('id').limit(limit+1);
      if(filter==='unread') query=query.is('read_at',null);if(filter==='read') query=query.not('read_at','is',null);
      const [result,counts,stats]=await Promise.all([query,supabase!.from('intentions').select('id',{count:'exact',head:true}).is('read_at',null),supabase!.from('community_totals').select('petitions,gratitudes,petitions_read,gratitudes_read,intercessors').single()]);
      if(current!==sequence) return;
      if(result.error||counts.error||stats.error) throw new Error('No pudimos actualizar la bandeja. Revisá tu conexión y tu sesión.');
      entries=result.data.slice(0,limit) as Entry[];hasMore=result.data.length>limit;unread=counts.count||0;totals=stats.data;
    }
    if(current!==sequence)return;
    put('#inbox-unread-count',String(unread));more.hidden=!hasMore;render();renderStats();
    if(!quiet) message(status,'');
  } finally {if(current===sequence)loading=false;}
}
let openedAt:string|null=null;
async function open(entry:Entry){
  if(opening)return;opening=true;message(status,'Abriendo mensaje…');
  try {
    let opened:Entry;
    if(demoMode){
      opened=demoEntries.find(e=>e.id===entry.id)!;
      if(!opened.read_at){opened.read_at=new Date().toISOString();if(opened.kind==='petition')totals.petitions_read++;else totals.gratitudes_read++;}
    } else {
      const {data,error}=await supabase!.rpc('open_intention',{p_id:entry.id});
      if(error||!data?.[0]) throw new Error('Este mensaje ya no está disponible o tu sesión venció. Actualizá la bandeja.');
      opened=data[0];
    }
    if(dashboard.hidden)return;
    put('#reader-name',opened.name);put('#reader-kind',opened.kind==='gratitude'?'Un agradecimiento':'Una petición');
    put('#reader-date',`Recibido: ${date(opened.created_at)} · Leído en la comunidad: ${date(opened.read_at!)}`);
    put('#reader-message',opened.message||'');openedAt=opened.read_at;
    if(!reader.open)reader.showModal();message(status,'El mensaje figura como leído para toda la comunidad.');
    await load(true).catch(error=>message(status,errorText(error),true));
  } catch(error){message(status,errorText(error),true);}
  finally{opening=false;}
}
root.querySelector('#reader-close')!.addEventListener('click',()=>reader.close());
reader.addEventListener('close',()=>{put('#reader-message','');put('#reader-name','');put('#reader-date','');openedAt=null;});
root.querySelectorAll<HTMLButtonElement>('[data-inbox-filter]').forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.inboxFilter!;limit=50;
  root.querySelectorAll('[data-inbox-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  load().catch(error=>message(status,errorText(error),true));
}));
more.addEventListener('click',()=>{limit+=50;load().catch(error=>message(status,errorText(error),true));});
root.querySelector('#inbox-refresh')!.addEventListener('click',()=>load().catch(error=>message(status,errorText(error),true)));
async function enter(focus=false){
  if(entering)return;entering=true;
  const generation=authGeneration;
  try {
    if(!demoMode){
      const {data:{session},error}=await supabase!.auth.getSession();if(error)throw error;if(!session)return;
      const member=await supabase!.from('members').select('display_name,role,approved').eq('user_id',session.user.id).maybeSingle();
      if(generation!==authGeneration)return;
      if(member.error)throw new Error('No pudimos verificar tu acceso. Intentá nuevamente.');
      if(!member.data?.approved||!['priest','intercessor'].includes(member.data.role)){await supabase!.auth.signOut();throw new Error('Esta cuenta no tiene acceso a Intercesor.');}
      put('#intercessor-welcome',`Bienvenido, ${member.data.display_name}`);
    } else put('#intercessor-welcome','Demostración · Mensajes ficticios. Los cambios se reinician al recargar.');
    await load();if(generation!==authGeneration)return;
    login.hidden=true;dashboard.hidden=false;loginForm.reset();setIntercessorView(true);
    if(focus)root.querySelector<HTMLElement>('#inbox-title')!.focus();
  } finally{entering=false;}
}
loginForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!loginForm.reportValidity())return;
  if(demoMode){message(authStatus,'Esta versión es una demostración. Usá el acceso de prueba de abajo.');return;}
  const button=loginForm.querySelector<HTMLButtonElement>('button')!;button.disabled=true;message(authStatus,'Ingresando…');
  const data=new FormData(loginForm);
  try{
    const session=await invoke<{access_token:string;refresh_token:string}>('intercessor-auth',{action:'login',username:data.get('username'),password:data.get('password')});
    const result=await supabase!.auth.setSession(session);if(result.error)throw new Error('No pudimos iniciar tu sesión. Intentá nuevamente.');
    await enter(true);message(authStatus,'');
  }catch(error){message(authStatus,errorText(error),true);}finally{button.disabled=false;}
});
const demoButton=root.querySelector<HTMLButtonElement>('#intercessor-demo')!;demoButton.hidden=!demoMode;
demoButton.addEventListener('click',()=>enter(true).catch(error=>message(authStatus,errorText(error),true)));
function leave(){
  authGeneration++;
  sequence++;loading=false;reader.close();list.replaceChildren();entries=[];dashboard.hidden=true;login.hidden=false;
  root.querySelectorAll('.community-stats strong').forEach(el=>el.textContent='0');put('#intercessor-welcome','');message(status,'');
  setIntercessorView(false);
}
root.querySelector('#intercessor-logout')!.addEventListener('click',async()=>{
  leave();if(supabase){const {error}=await supabase.auth.signOut();if(error)message(authStatus,'No pudimos cerrar la sesión del servidor. Volvé a intentarlo.',true);}
});
if(!demoMode){
  enter().catch(error=>message(authStatus,errorText(error),true));
  supabase!.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')leave();});
}
function refresh(){
  if(reader.open&&openedAt&&Date.now()-Date.parse(openedAt)>=48*3600000){reader.close();message(status,'El mensaje alcanzó las 48 horas desde su primera lectura.');}
  if(!document.hidden&&!dashboard.hidden&&!loading&&!opening)load(true).catch(error=>message(status,errorText(error),true));
}
setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);
