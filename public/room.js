'use strict';
const DAYS=['MON','TUE','WED','THU','FRI','SAT','SUN'];
const KO=['월','화','수','목','금','토','일'];
const H=24, NIGHT=7;
const PALETTE=['#e0775b','#3c8ad8','#8d6bd1','#2ea179','#cf9a12','#d45c9a','#45a2b6','#7f9434','#c4614a','#5b74c9'];
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const ROOM=location.pathname.split('/').filter(Boolean)[1]||'';
const LS='ts:'+ROOM;
const rd=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch(e){return null;}};
const wr=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}};

/* ---------- dates ---------- */
function mondayOf(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-(x.getDay()+6)%7);return x;}
function keyOf(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function sameDay(a,b){return keyOf(a)===keyOf(b);}
function fromKey(k){const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d);}
let cur=mondayOf(new Date());
const curKey=()=>keyOf(cur);
function relLabel(mon){
  const n=Math.round((mon-mondayOf(new Date()))/(7*864e5));
  if(n===0)return['이번 주',false];if(n===1)return['다음 주',false];if(n===-1)return['지난 주',true];
  return n>1?[n+'주 후',false]:[(-n)+'주 전',true];
}

/* ---------- code format ---------- */
function emptyGrid(){const g={};DAYS.forEach(d=>g[d]=Array(H).fill(false));return g;}
function hasAny(g){return !!g&&DAYS.some(d=>g[d].some(Boolean));}
function hoursIn(g){return g?DAYS.reduce((s,d)=>s+g[d].filter(Boolean).length,0):0;}
function encWeek(g){
  const parts=[];
  for(const d of DAYS){const h=g[d],r=[];let i=0;
    while(i<H){if(h[i]){let j=i;while(j<H&&h[j])j++;r.push(i+'-'+j);i=j;}else i++;}
    if(r.length)parts.push(d+r.join(','));}
  return parts.join('/');
}
function decWeek(s){
  const g=emptyGrid();if(!s||typeof s!=='string')return g;
  for(const seg of s.trim().split('/')){
    const m=seg.match(/^\s*([A-Za-z]{3})(.*)$/);if(!m)continue;
    const day=m[1].toUpperCase();if(!(day in g))continue;
    for(const r of m[2].split(',')){const t=r.trim();if(!t)continue;
      const mm=t.match(/^(\d+)\s*-\s*(\d+)$/);
      if(mm){for(let x=+mm[1];x<+mm[2];x++)if(x>=0&&x<H)g[day][x]=true;}
      else{const x=+t;if(Number.isInteger(x)&&x>=0&&x<H)g[day][x]=true;}}
  }
  return g;
}
function decAll(s){
  const out={};if(!s)return out;
  for(const b of s.split(';')){const m=b.trim().match(/^(\d{8}):(.*)$/);
    if(m)out[`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`]=decWeek(m[2]);}
  return out;
}
function toStore(weeks){const o={};Object.keys(weeks).sort().forEach(k=>{const s=encWeek(weeks[k]);if(s)o[k.replace(/-/g,'')]=s;});return o;}
function fromStore(o){const out={};if(!o||typeof o!=='object')return out;
  Object.keys(o).forEach(k=>{if(/^\d{8}$/.test(k)&&typeof o[k]==='string')out[`${k.slice(0,4)}-${k.slice(4,6)}-${k.slice(6,8)}`]=decWeek(o[k]);});return out;}

/* ---------- state ---------- */
const S={room:null,me:null,mine:{},others:[],isAdmin:false,showNight:false,minLen:1,th:null,off:[],sync:'connecting'};
let mode='paint',focus=null,spot=null,flash=null,viewG=null;
let sess=rd(LS);                 // {token,pid,name}
let adminKey=localStorage.getItem('ts_admin:'+ROOM)||'';
if(/^#admin=([a-z0-9]+)$/.test(location.hash)){
  adminKey=location.hash.slice(7);try{localStorage.setItem('ts_admin:'+ROOM,adminKey);}catch(e){}
  history.replaceState(null,'',location.pathname);
}

async function api(method,path,body){
  try{
    const r=await fetch('/api/rooms/'+ROOM+path,{method,
      headers:{'content-type':'application/json','x-token':(sess&&sess.token)||'','x-admin':adminKey},
      body:body?JSON.stringify(body):undefined});
    let data={};try{data=await r.json();}catch(e){}
    return{ok:r.ok,status:r.status,data};
  }catch(e){return{ok:false,status:0,data:{error:'네트워크에 연결할 수 없어요'}};}
}

/* ---------- load / save ---------- */
let dirty=false,inflight=false,painting=false,writeTimer=null,lastSent='',first=true;
async function load(){
  const r=await api('GET','');
  if(!r.ok){
    if(r.status===404){$('app').hidden=true;$('gone').hidden=false;return;}
    S.sync='offline';renderStatus();return;
  }
  const d=r.data;
  S.room=d.room;S.isAdmin=!!d.isAdmin;
  if(sess&&!d.me){sess=null;try{localStorage.removeItem(LS);}catch(e){}toast('다시 이름을 적고 들어와 주세요');}
  S.me=d.me?{id:d.me.id,name:d.me.name}:null;
  S.others=d.people.filter(p=>!d.me||p.id!==d.me.id).map(p=>({id:p.id,name:p.name,weeks:fromStore(p.weeks),at:p.at}));
  if(d.me&&!dirty&&!inflight&&!painting){S.mine=fromStore(d.me.weeks);lastSent=JSON.stringify(toStore(S.mine));}
  S.sync='live';
  if(first){first=false;mode=S.me?'paint':'team';$('app').hidden=false;}
  rememberRoom();renderAll();
}
function rememberRoom(){
  const list=(rd('ts_rooms')||[]).filter(x=>x.id!==ROOM);
  list.unshift({id:ROOM,name:S.room.name,admin:S.isAdmin||!!adminKey,me:S.me?S.me.name:'',at:Date.now()});
  wr('ts_rooms',list.slice(0,50));
}
function scheduleWrite(delay=600){
  if(!S.me)return;dirty=true;clearTimeout(writeTimer);writeTimer=setTimeout(flush,delay);renderStatus();
}
async function flush(){
  if(!S.me||inflight)return;
  const weeks=toStore(S.mine),sig=JSON.stringify(weeks);dirty=false;
  if(sig===lastSent){renderStatus();return;}
  inflight=true;renderStatus();
  const r=await api('PUT','/me',{weeks});
  inflight=false;
  if(r.ok){lastSent=sig;wr('ts_last',{room:ROOM,weeks});}
  else if(r.status===401){sess=null;S.me=null;try{localStorage.removeItem(LS);}catch(e){}toast('다시 이름을 적고 들어와 주세요');}
  else{dirty=true;toast(r.data.error||'저장하지 못했어요. 다시 시도해요');clearTimeout(writeTimer);writeTimer=setTimeout(flush,2500);}
  if(dirty&&!writeTimer)scheduleWrite(300);
  renderAll();
}
setInterval(()=>{if(document.visibilityState==='visible'&&!painting&&!dirty&&!inflight&&S.room)load();},8000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.room&&!dirty&&!inflight)load();});
window.addEventListener('beforeunload',()=>{if(dirty&&!inflight&&S.me){try{fetch('/api/rooms/'+ROOM+'/me',{method:'PUT',keepalive:true,headers:{'content-type':'application/json','x-token':sess.token},body:JSON.stringify({weeks:toStore(S.mine)})});}catch(e){}}});

/* ---------- mine ---------- */
function gridMine(){const k=curKey();if(!S.mine[k])S.mine[k]=emptyGrid();return S.mine[k];}
const clone=g=>JSON.parse(JSON.stringify(g));
function myName(){return S.me?S.me.name:'나';}
function isOff(key){return S.off.includes(key);}
function setOff(key,off){S.off=S.off.filter(k=>k!==key);if(off)S.off.push(key);}

/* ---------- people for current week ---------- */
function people(){
  const k=curKey(),list=[];
  if(S.me){const g=S.mine[k];list.push({key:'me',me:true,name:S.me.name,grid:hasAny(g)?g:null,on:!isOff('me'),color:'var(--me)',hasAny:Object.values(S.mine).some(hasAny)});}
  S.others.slice().sort((a,b)=>a.name.localeCompare(b.name,'ko')).forEach((p,i)=>{
    const w=p.weeks[k];
    list.push({key:'p:'+p.id,id:p.id,name:p.name,grid:hasAny(w)?w:null,on:!isOff('p:'+p.id),color:PALETTE[i%PALETTE.length],at:p.at,otherWeeks:Object.keys(p.weeks).length});
  });
  return list;
}
function effTh(total){if(total<1)return 1;return S.th==null?total:Math.min(Math.max(1,S.th),total);}
function counts(act){const c={};DAYS.forEach(d=>{c[d]=Array(H).fill(0);act.forEach(p=>{for(let h=0;h<H;h++)if(p.grid[d][h])c[d][h]++;});});return c;}

/* ---------- render: header ---------- */
function renderStatus(){
  const el=$('status'),t=$('status-text');let cls='',txt='';
  if(S.sync==='connecting')txt='연결하는 중';
  else if(S.sync==='offline'){cls='warn';txt='연결이 끊겼어요. 다시 시도하는 중';}
  else if(dirty||inflight){cls='live saving';txt='저장하는 중';}
  else{cls='live';txt=`${S.room?S.room.total:0}명 참여 중`;}
  el.className='status '+cls;t.textContent=txt;
}
function renderWeek(){
  const sun=addDays(cur,6);
  $('wk-range').textContent=`${cur.getMonth()+1}월 ${cur.getDate()}일 – ${sun.getMonth()===cur.getMonth()?'':(sun.getMonth()+1)+'월 '}${sun.getDate()}일`;
  const [lbl,past]=relLabel(cur);const r=$('wk-rel');r.textContent=lbl;r.className='rel'+(past?' past':'');
  $('wk-today').hidden=lbl==='이번 주';
}
let calMonth=new Date(cur.getFullYear(),cur.getMonth(),1);
function renderCal(){
  if($('cal-pop').hidden)return;
  $('cal-title').textContent=`${calMonth.getFullYear()}년 ${calMonth.getMonth()+1}월`;
  const g=$('cal-grid');g.innerHTML='';
  const start=mondayOf(calMonth),today=new Date();
  for(let i=0;i<42;i++){
    const day=addDays(start,i),wk=keyOf(mondayOf(day)),d=DAYS[(day.getDay()+6)%7];
    const b=document.createElement('button');b.type='button';b.className='calday';b.textContent=day.getDate();
    b.setAttribute('aria-label',`${day.getMonth()+1}월 ${day.getDate()}일이 있는 주로 이동`);
    if(day.getMonth()!==calMonth.getMonth())b.classList.add('other');
    if(wk===curKey())b.classList.add('inweek');
    if(sameDay(day,today))b.classList.add('today');
    const mine=S.mine[wk]&&S.mine[wk][d].some(Boolean);
    const tm=S.others.some(p=>p.weeks[wk]&&p.weeks[wk][d].some(Boolean));
    if(mine||tm){const mk=document.createElement('span');mk.className='marks';
      if(mine)mk.innerHTML+='<i class="m"></i>';if(tm)mk.innerHTML+='<i class="t"></i>';b.append(mk);}
    b.onclick=()=>{goWeek(mondayOf(day));closeCal();};
    g.append(b);
  }
}
function openCal(){calMonth=new Date(cur.getFullYear(),cur.getMonth(),1);$('cal-pop').hidden=false;$('wk-label').setAttribute('aria-expanded','true');renderCal();}
function closeCal(){$('cal-pop').hidden=true;$('wk-label').setAttribute('aria-expanded','false');}

/* ---------- render: grid ---------- */
function renderGrid(){
  if(painting)return;
  const ppl=people(),act=ppl.filter(p=>p.on&&p.grid),others=act.filter(p=>!p.me);
  const g=S.mine[curKey()]||emptyGrid();viewG=S.mine[curKey()]?S.mine[curKey()]:null;
  const total=act.length,th=effTh(total),cnt=counts(act),today=new Date();
  const forced=act.some(p=>DAYS.some(d=>p.grid[d].slice(0,NIGHT).some(Boolean)));
  const from=(S.showNight||forced)?0:NIGHT;
  const el=$('grid');el.className='grid '+mode;
  const sp=spot&&act.find(p=>p.key===spot);el.style.setProperty('--spot',sp?sp.color:'var(--me)');
  const f=document.createDocumentFragment();
  const corner=document.createElement('div');corner.className='corner';f.append(corner);
  DAYS.forEach((d,i)=>{const date=addDays(cur,i);const b=document.createElement('button');b.type='button';
    b.className='dh'+(i===5?' sat':i===6?' sun':'')+(sameDay(date,today)?' today':'');b.dataset.day=d;
    b.innerHTML=`<span class="dk">${KO[i]}</span><span class="dd">${date.getMonth()+1}/${date.getDate()}</span>`;
    if(mode==='paint')b.title=`${KO[i]}요일 보이는 시간 전체 켜기/끄기`;else b.tabIndex=-1;
    f.append(b);});
  for(let h=from;h<H;h++){
    const split=(h===12||h===18)?' split':'';
    const lb=document.createElement('button');lb.type='button';lb.className='hl'+split+(h%6===0?' mark':'');lb.dataset.h=h;lb.textContent=pad(h);
    if(mode==='paint')lb.title=`${pad(h)}:00–${pad(h+1)}:00 일주일 전체 켜기/끄기`;else lb.tabIndex=-1;
    f.append(lb);
    DAYS.forEach(d=>{
      const c=document.createElement('div');c.className='c'+split;c.dataset.d=d;c.dataset.h=h;
      if(mode==='paint'){
        if(S.me&&g[d][h])c.classList.add('on');
        const n=others.length?others.filter(p=>p.grid[d][h]).length:0;
        if(n){c.dataset.bg=`color-mix(in srgb, var(--accent) ${Math.round(10+38*n/others.length)}%, var(--surface-2))`;if(!(S.me&&g[d][h]))c.style.backgroundColor=c.dataset.bg;}
      }else{
        const n=cnt[d][h];
        if(n){const r=n/total;c.style.background=`color-mix(in srgb, var(--accent) ${Math.round(16+84*r)}%, var(--surface-2))`;
          c.style.color=r>.5?'var(--accent-ink)':'var(--ink)';c.textContent=n;}
        if(n<th)c.classList.add('below');
        if(total&&n===total)c.classList.add('full');
        if(sp&&sp.grid[d][h])c.classList.add('spot');
        if(focus&&focus.d===d&&focus.h===h)c.classList.add('sel');
        if(flash&&flash.has(d+h))c.classList.add('flash');
      }
      f.append(c);
    });
  }
  el.innerHTML='';el.append(f);
  const nb=$('toggle-night');
  if(forced){nb.textContent='새벽(00–06시)에 입력이 있어 펼쳐 뒀어요';nb.disabled=true;}
  else{nb.disabled=false;nb.textContent=from?'＋ 00–06시 펼치기':'－ 00–06시 접기';}
  renderLegend(total,others.length);
  renderDetail();
  $('paint-tools').hidden=mode!=='paint'||!S.me;
  $('mode-paint').setAttribute('aria-selected',mode==='paint');$('mode-team').setAttribute('aria-selected',mode==='team');
  $('team-count').textContent=total||'';
}
function renderLegend(total,othersN){
  const el=$('legend');
  if(mode==='paint'){
    el.innerHTML=`<span><i class="sw" style="background:var(--me)"></i>내가 되는 시간</span>`+
      (othersN?`<span><span class="ramp"><i style="background:color-mix(in srgb,var(--accent) 14%,var(--surface-2))"></i><i style="background:color-mix(in srgb,var(--accent) 30%,var(--surface-2))"></i><i style="background:color-mix(in srgb,var(--accent) 48%,var(--surface-2))"></i></span>다른 사람이 많이 되는 시간</span>`:'');
  }else if(!total){el.innerHTML='<span>이 주에 입력한 사람이 없어요</span>';}
  else{
    const steps=[...new Set([1,Math.ceil(total/2),total])];
    el.innerHTML=`<span><span class="ramp">${steps.map(n=>`<i style="background:color-mix(in srgb,var(--accent) ${Math.round(16+84*n/total)}%,var(--surface-2))"></i>`).join('')}</span>1명 → ${total}명</span><span><i class="sw" style="box-shadow:inset 0 0 0 2px var(--ink)"></i>전원 가능</span><span><i class="sw" style="opacity:.4;background:color-mix(in srgb,var(--accent) 40%,var(--surface-2))"></i>최소 인원 미만</span>`;
  }
}
function renderDetail(){
  const el=$('detail');el.innerHTML='';
  if(mode==='paint'){
    if(!S.me){el.innerHTML='<span class="when">먼저 오른쪽에서 이름을 적고 들어가 주세요</span>';return;}
    const n=hoursIn(S.mine[curKey()]);
    el.innerHTML=`<span class="when">${n?`이번 주 ${n}시간 칠함`:'아직 칠한 칸이 없어요'}</span>`;
    const hint=document.createElement('span');hint.className='hint';
    hint.textContent='칸을 누른 채 끌어서 칠하고, 칠한 칸에서 시작하면 지워져요. 요일이나 시각 머리글을 누르면 한 줄이 통째로 바뀌어요.';
    el.append(hint);return;
  }
  const act=people().filter(p=>p.on&&p.grid);
  if(!focus){el.innerHTML=`<span class="hint">${act.length?'칸에 마우스를 올리거나 눌러서 누가 되는지 확인하세요.':'이 주에 칠한 사람이 아직 없어요.'}</span>`;return;}
  const di=DAYS.indexOf(focus.d),date=addDays(cur,di);
  const yes=act.filter(p=>p.grid[focus.d][focus.h]),no=act.filter(p=>!p.grid[focus.d][focus.h]);
  const w=document.createElement('span');w.className='when';w.textContent=`${date.getMonth()+1}/${date.getDate()}(${KO[di]}) ${pad(focus.h)}:00–${pad(focus.h+1)}:00`;
  const c=document.createElement('span');c.className='cnt';c.textContent=`${yes.length}/${act.length}명`;
  const nm=document.createElement('span');nm.className='names';
  [...yes.map(p=>[p,true]),...no.map(p=>[p,false])].forEach(([p,ok])=>{
    const s=document.createElement('span');s.className='nm'+(ok?'':' no');
    const dt=document.createElement('i');dt.className='dot';dt.style.setProperty('--c',p.color);
    s.append(dt,document.createTextNode(p.name));nm.append(s);});
  el.append(w,c,nm);
}

/* ---------- render: side ---------- */
function renderMe(){
  $('card-join').hidden=!!S.me;$('card-me').hidden=!S.me;
  if(S.me){
    $('me-name').textContent=S.me.name;
    const n=Object.keys(S.mine).filter(k=>hasAny(S.mine[k])).length;
    $('me-meta').textContent=n?`${n}주 입력함`:'';
    const last=rd('ts_last');
    $('import-last').hidden=!(last&&last.room!==ROOM&&Object.keys(last.weeks||{}).length&&!Object.values(S.mine).some(hasAny));
  }
  const ca=$('card-admin');ca.hidden=!S.isAdmin;
  if(S.isAdmin&&S.room){
    if(document.activeElement!==$('admin-name'))$('admin-name').value=S.room.name;
    document.querySelectorAll('#admin-show button').forEach(b=>b.setAttribute('aria-checked',b.dataset.v===S.room.show));
  }
  $('room-title').textContent=S.room?S.room.name:'';
  document.title=S.room?`${S.room.name} · 스케줄 핏`:'스케줄 핏';
}
function renderMembers(){
  const ul=$('member-list');ul.innerHTML='';
  const ppl=people();
  ppl.forEach(p=>{
    const li=document.createElement('li');li.className='member'+(p.on?'':' off');
    const sb=document.createElement('button');sb.type='button';sb.className='spotbtn';sb.style.setProperty('--c',p.color);
    sb.setAttribute('aria-pressed',spot===p.key);sb.title='겹침 보기에서 이 사람 시간 강조';sb.setAttribute('aria-label',`${p.name} 강조`);
    const dt=document.createElement('i');dt.className='dot';dt.style.setProperty('--c',p.color);sb.append(dt);
    sb.onclick=()=>{spot=spot===p.key?null:p.key;if(spot)mode='team';renderAll();};
    const who=document.createElement('div');who.className='who';
    const nm=document.createElement('span');nm.className=p.me?'me':'nm';nm.textContent=p.name;
    if(p.me){const sm=document.createElement('small');sm.textContent='나';nm.append(sm);}
    who.append(nm);
    const meta=document.createElement('span');meta.className='meta';
    meta.textContent=p.grid?`${hoursIn(p.grid)}시간`:(p.me?(p.hasAny?'다른 주만':'이번 주 없음'):(p.otherWeeks?'다른 주만':'이번 주 없음'));
    const sw=document.createElement('label');sw.className='switch';sw.title='겹침 계산에 포함';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=p.on;cb.setAttribute('aria-label',`${p.name} 겹침 계산에 포함`);
    cb.onchange=()=>{setOff(p.key,!cb.checked);renderAll();};
    sw.append(cb,document.createElement('span'));
    const del=document.createElement('button');del.type='button';del.className='del';del.textContent='×';
    if(S.isAdmin&&!p.me){del.setAttribute('aria-label',`${p.name} 내보내기`);del.title='방에서 내보내기';del.onclick=()=>removePerson(p);}
    else{del.classList.add('ph');del.tabIndex=-1;del.setAttribute('aria-hidden','true');}
    li.append(sb,who,meta,sw,del);ul.append(li);
  });
  if(!ppl.length){
    const li=document.createElement('li');li.className='member empty';
    li.textContent=S.room&&S.room.show==='admin'&&!S.isAdmin?'이 방은 방장만 다른 사람의 시간을 볼 수 있어요.':'아직 참여한 사람이 없어요. 초대 링크를 보내 보세요.';
    ul.append(li);
  }
  const act=ppl.filter(p=>p.on&&p.grid).length;
  $('team-meta').textContent=`이번 주 ${act}명 반영`;
}
function slots(){
  const act=people().filter(p=>p.on&&p.grid),total=act.length;if(!total)return{total,th:1,list:[]};
  const th=effTh(total),cnt=counts(act),list=[],todayKey=keyOf(new Date());
  DAYS.forEach((d,di)=>{let h=0;while(h<H){
    if(cnt[d][h]>=th){let j=h,minc=Infinity;while(j<H&&cnt[d][j]>=th){minc=Math.min(minc,cnt[d][j]);j++;}
      const date=addDays(cur,di);
      if(j-h>=S.minLen)list.push({d,di,start:h,end:j,len:j-h,minc,date,past:keyOf(date)<todayKey});h=j;}
    else h++;}});
  list.sort((a,b)=>a.past-b.past||b.minc-a.minc||b.len-a.len||a.di-b.di||a.start-b.start);
  return{total,th,list};
}
function renderBest(){
  const {total,th,list}=slots();
  $('th-val').textContent=total?`${th}명${th===total?' (전원)':''}`:'–';
  $('th-minus').disabled=!total||th<=1;$('th-plus').disabled=!total||th>=total;
  document.querySelectorAll('#len-chips button').forEach(b=>b.setAttribute('aria-checked',+b.dataset.len===S.minLen));
  const ol=$('best-list');ol.innerHTML='';
  if(!total){ol.innerHTML='<li class="empty">이 주에 칠한 사람이 없어요. 시간을 칠하거나 다른 주로 이동해 보세요.</li>';return;}
  if(!list.length){ol.innerHTML=`<li class="empty">${th}명 이상, ${S.minLen}시간 이상 겹치는 시간이 없어요. 최소 인원이나 길이를 줄여 보세요.</li>`;return;}
  list.slice(0,8).forEach(r=>{
    const li=document.createElement('li');if(r.past)li.className='past';
    const b=document.createElement('button');b.type='button';
    b.innerHTML=`<span class="bd${r.di===5?' sat':r.di===6?' sun':''}">${r.date.getMonth()+1}/${r.date.getDate()} ${KO[r.di]}</span>`+
      `<span class="bt">${pad(r.start)}:00–${pad(r.end)}:00<small>${r.len}시간</small></span>`+
      `<span class="bc">${r.minc===total&&total>1?'<span class="pill">전원</span>':''}${r.minc}/${total}</span>`;
    b.onclick=()=>showSlot(r);li.append(b);ol.append(li);
  });
  if(list.length>8){const li=document.createElement('li');li.className='more';li.textContent=`외 ${list.length-8}개 시간대`;ol.append(li);}
}
function renderAll(){renderStatus();renderWeek();renderGrid();renderMe();renderMembers();renderBest();renderCal();}

/* ---------- actions ---------- */
function goWeek(mon){cur=mon;focus=null;flash=null;renderAll();}
function pushUndo(){history_.push({wk:curKey(),enc:encWeek(gridMine())});if(history_.length>80)history_.shift();$('act-undo').disabled=false;}
const history_=[];
function undo(){
  const s=history_.pop();$('act-undo').disabled=!history_.length;if(!s)return;
  S.mine[s.wk]=decWeek(s.enc);if(s.wk!==curKey())cur=fromKey(s.wk);
  commit();toast('되돌렸어요');
}
function commit(){scheduleWrite();renderAll();}
function needJoin(){toast('먼저 이름을 적고 들어가 주세요');const i=$('join-name');if(i&&!$('card-join').hidden){i.scrollIntoView({block:'center'});i.focus();}}
function showSlot(r){
  mode='team';focus={d:r.d,h:r.start};flash=new Set();for(let h=r.start;h<r.end;h++)flash.add(r.d+h);
  renderAll();flash=null;
  const board=document.querySelector('.board'),rect=board.getBoundingClientRect();
  if(rect.top<0||rect.top>innerHeight*.5)board.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}
async function removePerson(p){
  const r=await api('DELETE','/people/'+p.id);
  if(!r.ok){toast(r.data.error||'내보내지 못했어요');return;}
  if(spot===p.key)spot=null;toast(`${p.name} 님을 내보냈어요`);load();
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true;}
  catch(e){try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.append(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;}catch(_){return false;}}
}
let tt;
function toast(msg,action){
  const t=$('toast');t.innerHTML='';const s=document.createElement('span');s.textContent=msg;t.append(s);
  if(action){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.onclick=()=>{t.classList.remove('show');action.fn();};t.append(b);}
  t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),action?4500:2000);
}

/* ---------- grid interactions ---------- */
const gridEl=$('grid');let paintVal=true;
function setCell(c){
  const d=c.dataset.d,h=+c.dataset.h,g=gridMine();if(g[d][h]===paintVal)return;
  g[d][h]=paintVal;c.classList.toggle('on',paintVal);c.style.backgroundColor=paintVal?'':(c.dataset.bg||'');
}
gridEl.addEventListener('pointerdown',e=>{
  if(mode!=='paint'||e.button>0)return;const c=e.target.closest('.c');if(!c)return;
  if(!S.me){needJoin();return;}
  e.preventDefault();pushUndo();paintVal=!gridMine()[c.dataset.d][+c.dataset.h];painting=true;setCell(c);
  try{gridEl.setPointerCapture(e.pointerId);}catch(_){}
});
gridEl.addEventListener('pointermove',e=>{
  if(!painting)return;const t=document.elementFromPoint(e.clientX,e.clientY);const c=t&&t.closest&&t.closest('.c');
  if(c&&gridEl.contains(c))setCell(c);
});
function endPaint(){if(!painting)return;painting=false;commit();}
gridEl.addEventListener('pointerup',endPaint);gridEl.addEventListener('pointercancel',endPaint);window.addEventListener('pointerup',endPaint);
function setFocus(c){
  const nf={d:c.dataset.d,h:+c.dataset.h};if(focus&&focus.d===nf.d&&focus.h===nf.h)return;focus=nf;
  gridEl.querySelectorAll('.c.sel').forEach(x=>x.classList.remove('sel'));c.classList.add('sel');renderDetail();
}
gridEl.addEventListener('pointerover',e=>{if(mode!=='team'||e.pointerType==='touch')return;const c=e.target.closest('.c');if(c)setFocus(c);});
gridEl.addEventListener('click',e=>{
  if(mode==='team'){const c=e.target.closest('.c');if(c)setFocus(c);return;}
  const dh=e.target.closest('.dh'),hl=e.target.closest('.hl');if(!dh&&!hl)return;
  if(!S.me){needJoin();return;}
  const g=gridMine(),first=gridEl.querySelector('.hl'),from=first?+first.dataset.h:0;pushUndo();
  if(dh){const d=dh.dataset.day,all=g[d].slice(from).every(Boolean);for(let h=from;h<H;h++)g[d][h]=!all;}
  else{const h=+hl.dataset.h,all=DAYS.every(d=>g[d][h]);DAYS.forEach(d=>g[d][h]=!all);}
  commit();
});

/* ---------- controls ---------- */
$('mode-paint').onclick=()=>{mode='paint';if(!S.me)needJoin();renderGrid();};
$('mode-team').onclick=()=>{mode='team';renderGrid();};
$('wk-prev').onclick=()=>goWeek(addDays(cur,-7));
$('wk-next').onclick=()=>goWeek(addDays(cur,7));
$('wk-today').onclick=()=>goWeek(mondayOf(new Date()));
$('wk-label').onclick=e=>{e.stopPropagation();$('cal-pop').hidden?openCal():closeCal();};
$('cal-prev').onclick=()=>{calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()-1,1);renderCal();};
$('cal-next').onclick=()=>{calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+1,1);renderCal();};
$('cal-pop').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{if(!$('cal-pop').hidden)closeCal();});
$('toggle-night').onclick=()=>{S.showNight=!S.showNight;renderGrid();};

$('act-weekday').onclick=()=>{pushUndo();const g=gridMine();DAYS.slice(0,5).forEach(d=>{for(let h=9;h<18;h++)g[d][h]=true;});commit();};
$('act-clear').onclick=()=>{if(!hasAny(S.mine[curKey()])){toast('이 주는 이미 비어 있어요');return;}pushUndo();S.mine[curKey()]=emptyGrid();commit();toast('이 주를 비웠어요',{label:'되돌리기',fn:undo});};
$('act-copyprev').onclick=()=>{
  const p=S.mine[keyOf(addDays(cur,-7))];if(!hasAny(p)){toast('지난 주에 칠한 칸이 없어요');return;}
  pushUndo();S.mine[curKey()]=clone(p);commit();toast('지난 주 시간을 복사했어요');
};
$('act-undo').onclick=undo;

$('copy-invite').onclick=async()=>toast(await copyText(location.origin+'/r/'+ROOM)?'초대 링크를 복사했어요':'복사가 막혀 있어요. 주소창의 링크를 직접 복사해 주세요');
$('copy-admin').onclick=async()=>toast(await copyText(location.origin+'/r/'+ROOM+'#admin='+adminKey)?'방장 링크를 복사했어요. 다른 사람에게 보내지 마세요':'복사하지 못했어요');

$('join-btn').onclick=async()=>{
  const name=$('join-name').value.trim(),pin=$('join-pin').value.trim();
  if(!name){$('join-name').focus();toast('이름을 적어 주세요');return;}
  $('join-btn').disabled=true;
  const r=await api('POST','/join',{name,pin});
  $('join-btn').disabled=false;
  if(!r.ok){toast(r.data.error||'들어가지 못했어요');return;}
  sess={token:r.data.token,pid:r.data.pid,name:r.data.name};wr(LS,sess);
  S.me={id:r.data.pid,name:r.data.name};mode='paint';
  await load();toast(`${name} 님, 환영해요`);
};
$('join-name').addEventListener('keydown',e=>{if(e.key==='Enter')$('join-btn').click();});
$('join-pin').addEventListener('keydown',e=>{if(e.key==='Enter')$('join-btn').click();});
$('leave-btn').onclick=()=>{
  if(dirty)flush();sess=null;try{localStorage.removeItem(LS);}catch(e){}S.me=null;S.mine={};mode='team';renderAll();toast('이 기기에서 나갔어요. 같은 이름과 비밀번호로 다시 들어올 수 있어요');
};
$('import-last').onclick=()=>{
  const last=rd('ts_last');if(!last)return;S.mine=fromStore(last.weeks);dirty=true;scheduleWrite(0);renderAll();toast('다른 방에서 칠한 시간을 가져왔어요');
};
$('load-btn').onclick=()=>{
  const v=$('load-code').value.trim();const m=v.match(/(\d{8}:[A-Za-z]{3}[0-9A-Za-z,\-\/;:]*)/);
  const w=m?decAll(m[1].replace(/[;:,\/-]+$/,'')):{};
  if(!Object.keys(w).length){toast('코드 형식을 확인해 주세요');return;}
  pushUndo();Object.keys(w).forEach(k=>S.mine[k]=w[k]);$('load-code').value='';mode='paint';commit();toast(`${Object.keys(w).length}주치 시간을 불러왔어요`);
};

let nameTimer=null;
$('admin-name').oninput=e=>{const v=e.target.value.trim();clearTimeout(nameTimer);if(!v)return;
  nameTimer=setTimeout(async()=>{const r=await api('PATCH','',{name:v});if(r.ok){S.room.name=v;$('room-title').textContent=v;rememberRoom();}else toast(r.data.error||'이름을 바꾸지 못했어요');},700);};
$('admin-show').onclick=async e=>{const b=e.target.closest('button');if(!b)return;
  const r=await api('PATCH','',{show:b.dataset.v});if(!r.ok){toast(r.data.error||'바꾸지 못했어요');return;}
  S.room.show=b.dataset.v;renderMe();toast(b.dataset.v==='all'?'참여자 모두가 결과를 볼 수 있어요':'이제 방장만 다른 사람의 시간을 볼 수 있어요');};
let delArmed=false;
$('del-room').onclick=async()=>{
  if(!delArmed){delArmed=true;$('del-room').textContent='정말 삭제할까요? 한 번 더 누르세요';setTimeout(()=>{delArmed=false;$('del-room').textContent='방 삭제';},4000);return;}
  const r=await api('DELETE','');if(!r.ok){toast(r.data.error||'삭제하지 못했어요');return;}
  wr('ts_rooms',(rd('ts_rooms')||[]).filter(x=>x.id!==ROOM));location.href='/';
};

$('th-minus').onclick=()=>{const t=slots().total;S.th=Math.max(1,effTh(t)-1);renderGrid();renderBest();};
$('th-plus').onclick=()=>{const t=slots().total,n=effTh(t)+1;S.th=n>=t?null:n;renderGrid();renderBest();};
$('len-chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;S.minLen=+b.dataset.len;renderBest();};
$('copy-best').onclick=async()=>{
  const {total,th,list}=slots();const future=list.filter(r=>!r.past);
  if(!future.length){toast('복사할 추천 시간이 없어요');return;}
  const sun=addDays(cur,6);
  const lines=[`[${S.room.name}] ${cur.getMonth()+1}/${cur.getDate()}–${sun.getMonth()+1}/${sun.getDate()} · ${total}명 중 ${th}명 이상`,
    ...future.slice(0,5).map((r,i)=>`${i+1}. ${r.date.getMonth()+1}/${r.date.getDate()}(${KO[r.di]}) ${pad(r.start)}:00~${pad(r.end)}:00 · ${r.minc===total?'전원':r.minc+'명'} 가능`)];
  toast(await copyText(lines.join('\n'))?'추천 시간을 복사했어요':'복사가 막혀 있어요. 목록을 보고 직접 적어 주세요');
};

document.addEventListener('keydown',e=>{
  const tag=(e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea')return;
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}
  else if(e.key==='Escape')closeCal();
});

/* ---------- init ---------- */
if(!/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent))document.querySelector('#act-undo .kbd').textContent='Ctrl+Z';
if(!ROOM){$('gone').hidden=false;}else load();
