// ─── STORAGE ─────────────────────────────────────────
const CLOUD_TOKEN_KEY = 'cheri_finance_cloud_token';
const CLOUD_API_KEY = 'cheri_finance_cloud_api';
const PANEL_KEY = 'kf_v4_panel';
const PANEL_TAB_PREFIX = 'cheri-finance-panel:';
const DUE_PING_SESSION_KEY = 'cheri_finance_due_ping';
const DEFAULT_CLOUD_API_URL = 'https://cheri-finance-reminders.cherife1198.workers.dev/api/data';
let STORE = normalizeStore();
let cloudToken = '';
let cloudApiUrl = DEFAULT_CLOUD_API_URL;
let cloudReady = false;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudDirty = false;
let appInitialized = false;

function gs() { return STORE; }
function ss(d) {
  STORE = normalizeStore(d);
  cloudDirty = true;
  queueCloudSave();
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function toLocalYmd(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function td() { return toLocalYmd(new Date()); }

function seed() {
  return {
    settings: { name:'Cheri', rate:59.891, balance:0, savings:0, savingsPrevious:0, savingsHistory:[], dueAlertDays:7 },
    categories: {
      expense: ['OTHER'],
      income: ['OTHER INCOME']
    },
    transactions: [],
    loans: [],
    subscriptions: [],
    mandatoryExpenses: [],
    budgetLines: [],
    upworkLogs: []
  };
}

function normalizeStore(data = {}) {
  const base = seed();
  const src = data && typeof data === 'object' ? data : {};
  return {
    ...base,
    ...src,
    settings:{...base.settings,...(src.settings||{})},
    categories:{...base.categories,...(src.categories||{})},
    transactions:Array.isArray(src.transactions)?src.transactions:base.transactions,
    loans:Array.isArray(src.loans)?src.loans:base.loans,
    subscriptions:Array.isArray(src.subscriptions)?src.subscriptions:base.subscriptions,
    mandatoryExpenses:Array.isArray(src.mandatoryExpenses)?src.mandatoryExpenses:base.mandatoryExpenses,
    budgetLines:Array.isArray(src.budgetLines)?src.budgetLines:base.budgetLines,
    upworkLogs:Array.isArray(src.upworkLogs)?src.upworkLogs:base.upworkLogs
  };
}

function cloudHeaders(){
  return {
    'Content-Type':'application/json',
    'x-finance-token':cloudToken
  };
}

function setCloudStatus(message, tone=''){
  const el=document.getElementById('cloud-status');
  if(el){
    el.textContent=message;
    el.className=`cloud-status ${tone}`.trim();
  }
}

function queueCloudSave(){
  if(!cloudReady||!cloudToken) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(saveCloudData,450);
}

async function saveCloudData(){
  if(!cloudReady||!cloudToken||cloudSaveInFlight||!cloudDirty) return;
  cloudSaveInFlight=true;
  cloudDirty=false;
  setCloudStatus('Saving to Cloudflare...', 'saving');
  try{
    const res=await fetch(cloudApiUrl,{method:'PUT',headers:cloudHeaders(),body:JSON.stringify(STORE)});
    const body=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(body.error||`Cloud save failed (${res.status})`);
    setCloudStatus('Cloud saved', 'saved');
  }catch(err){
    cloudDirty=true;
    setCloudStatus(`Cloud save failed: ${err.message}`, 'error');
    toast('Cloud save failed','var(--red)');
  }finally{
    cloudSaveInFlight=false;
    if(cloudDirty) queueCloudSave();
  }
}

function showUnlock(message='Enter your private cloud token to load your finance data.'){
  const msg=document.getElementById('unlock-msg');
  if(msg) msg.textContent=message;
  const api=document.getElementById('unlock-api');
  if(api) api.value=cloudApiUrl;
  document.getElementById('m-unlock')?.classList.add('open');
}

function hideUnlock(){
  document.getElementById('m-unlock')?.classList.remove('open');
}

async function unlockCloudData(){
  cloudToken=(document.getElementById('unlock-token')?.value||'').trim();
  cloudApiUrl=(document.getElementById('unlock-api')?.value||DEFAULT_CLOUD_API_URL).trim()||DEFAULT_CLOUD_API_URL;
  if(!cloudToken){
    showUnlock('Token is required so the cloud data stays private.');
    return;
  }
  sessionStorage.setItem(CLOUD_TOKEN_KEY,cloudToken);
  sessionStorage.setItem(CLOUD_API_KEY,cloudApiUrl);
  await loadCloudData();
}

async function loadCloudData(){
  setCloudStatus('Loading cloud data...', 'saving');
  try{
    const res=await fetch(cloudApiUrl,{headers:{'x-finance-token':cloudToken}});
    const body=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(body.error||`Cloud load failed (${res.status})`);
    STORE=normalizeStore(body.data||seed());
    cloudReady=true;
    cloudDirty=false;
    hideUnlock();
    finishAppInit();
    setCloudStatus(body.data?'Cloud data loaded':'Cloud ready with a new blank file', 'saved');
  }catch(err){
    cloudReady=false;
    sessionStorage.removeItem(CLOUD_TOKEN_KEY);
    showUnlock(`${err.message}. Check the token, Worker route, and Cloudflare deployment.`);
    setCloudStatus('Cloud locked', 'error');
  }
}

function nextDueDate(day){if(!day)return null;const t=new Date();t.setHours(0,0,0,0);let y=t.getFullYear(),m=t.getMonth();let last=new Date(y,m+1,0).getDate();let d=Math.min(+day,last);let nd=new Date(y,m,d);if(nd<t){m++;if(m>11){m=0;y++;}last=new Date(y,m+1,0).getDate();d=Math.min(+day,last);nd=new Date(y,m,d);}return nd;}
function dueBadge(day){const d=nextDueDate(day);if(!d)return '<span style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">—</span>';const t=new Date();t.setHours(0,0,0,0);const diff=Math.round((d-t)/86400000);const ds=d.toLocaleDateString('en-PH',{month:'short',day:'numeric'});let cls='chip-m',txt='Due '+ds;if(diff===0){cls='chip-r';txt='Due today';}else if(diff<0){cls='chip-r';txt='Overdue '+(-diff)+'d';}else if(diff<=3){cls='chip-a';txt='In '+diff+'d · '+ds;}else if(diff<=7){cls='chip-b';txt='In '+diff+'d · '+ds;}return `<span class="chip ${cls}" style="font-size:10px;padding:2px 6px;white-space:nowrap">${txt}</span>`;}
function dueDateBadge(dateStr){if(!dateStr)return '<span style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">—</span>';const d=new Date(dateStr+'T00:00:00');if(Number.isNaN(d.getTime()))return '<span style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">—</span>';const t=new Date();t.setHours(0,0,0,0);const diff=Math.round((d-t)/86400000);const ds=d.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});let cls='chip-m',txt=ds;if(diff===0){cls='chip-r';txt='Due today';}else if(diff<0){cls='chip-r';txt='Overdue '+(-diff)+'d · '+ds;}else if(diff<=3){cls='chip-a';txt='In '+diff+'d · '+ds;}else if(diff<=7){cls='chip-b';txt='In '+diff+'d · '+ds;}return `<span class="chip ${cls}" style="font-size:10px;padding:2px 6px;white-space:nowrap">${txt}</span>`;}
function recurringDateFromAnchor(anchorDate, cycle, steps=0){
  if(!(anchorDate instanceof Date)||Number.isNaN(anchorDate.getTime())) return null;
  const normalizedCycle=(cycle||'monthly').toLowerCase();
  if(normalizedCycle==='weekly'){
    const d=new Date(anchorDate.getTime());
    d.setDate(d.getDate()+(7*steps));
    return d;
  }
  if(normalizedCycle==='yearly'){
    const d=new Date(anchorDate.getTime());
    const targetMonth=anchorDate.getMonth();
    const targetDay=anchorDate.getDate();
    d.setDate(1);
    d.setFullYear(anchorDate.getFullYear()+steps, targetMonth, 1);
    const lastDay=new Date(d.getFullYear(),targetMonth+1,0).getDate();
    d.setDate(Math.min(targetDay,lastDay));
    return d;
  }
  const d=new Date(anchorDate.getTime());
  const targetDay=anchorDate.getDate();
  d.setDate(1);
  d.setMonth(anchorDate.getMonth()+steps);
  const lastDay=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(targetDay,lastDay));
  return d;
}
function nextRecurringDate(dateStr, cycle='monthly'){
  const normalized=normalizeDateInput(dateStr);
  if(!normalized) return null;
  const anchor=new Date(normalized+'T00:00:00');
  if(Number.isNaN(anchor.getTime())) return null;
  const today=new Date();
  today.setHours(0,0,0,0);
  let candidate=recurringDateFromAnchor(anchor, cycle, 0);
  let guard=0;
  let step=0;
  while(candidate<today && guard<600){
    step++;
    candidate=recurringDateFromAnchor(anchor, cycle, step);
    guard++;
  }
  return candidate;
}
function subscriptionAnchorDate(sub){
  const direct=normalizeDateInput(sub?.dueDate||sub?.billingDate||'');
  if(direct) return direct;
  const legacyDue=nextDueDate(sub?.due);
  return legacyDue?toLocalYmd(legacyDue):'';
}
function subscriptionNextDue(sub){
  const anchor=subscriptionAnchorDate(sub);
  return nextRecurringDate(anchor, sub?.cycle||'monthly');
}
function subscriptionDueBadge(sub){
  const d=subscriptionNextDue(sub);
  if(!d) return '<span style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">—</span>';
  const t=new Date();
  t.setHours(0,0,0,0);
  const diff=Math.round((d-t)/86400000);
  const ds=d.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
  let cls='chip-m',txt='Due '+ds;
  if(diff===0){cls='chip-r';txt='Due today';}
  else if(diff<0){cls='chip-r';txt='Overdue '+(-diff)+'d · '+ds;}
  else if(diff<=3){cls='chip-a';txt='In '+diff+'d · '+ds;}
  else if(diff<=7){cls='chip-b';txt='In '+diff+'d · '+ds;}
  return `<span class="chip ${cls}" style="font-size:10px;padding:2px 6px;white-space:nowrap">${txt}</span>`;
}

// ─── FORMAT ─────────────────────────────────────────
const P = v => '₱' + Math.abs(+v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const F = v => (+v||0).toFixed(2);
const signedPeso = v => `${(+v||0) < 0 ? '-' : '+'}${P(Math.abs(+v||0))}`;
function currentSavings(settings){
  return +(settings?.savings||0)||0;
}
function savingsSnapshots(settings){
  return (Array.isArray(settings?.savingsHistory)?settings.savingsHistory:[])
    .map(entry=>({
      id:entry?.id||uid(),
      date:normalizeDateInput(entry?.date)||td(),
      month:(entry?.month||normalizeDateInput(entry?.date)||td()).slice(0,7),
      amount:+entry?.amount||0
    }))
    .filter(entry=>entry.month&&Number.isFinite(entry.amount));
}
function lastMonthSavings(settings){
  const curM=td().slice(0,7);
  if(settings&&Object.prototype.hasOwnProperty.call(settings,'savingsPrevious')) return +settings.savingsPrevious||0;
  const entries=savingsSnapshots(settings).sort((a,b)=>a.month.localeCompare(b.month)||a.date.localeCompare(b.date));
  const older=entries.filter(entry=>entry.month<curM);
  if(older.length) return +older[older.length-1].amount||0;
  const firstThisMonth=entries.find(entry=>entry.month===curM);
  return firstThisMonth?(+firstThisMonth.amount||0):0;
}
function savingsMonthDelta(settings,overrideCurrent,overrideBase){
  const current=overrideCurrent==null?currentSavings(settings):(+overrideCurrent||0);
  const base=overrideBase==null?lastMonthSavings(settings):(+overrideBase||0);
  return current-base;
}
function savingsDeltaClass(delta){
  return delta<0?'r':delta>0?'g':'m';
}
function savingsDeltaText(delta){
  return Math.abs(+delta||0)<0.01?P(0):signedPeso(delta);
}
function savingsDeltaLabel(delta){
  return delta>0?'Added this month':delta<0?'Lessened this month':'Changed this month';
}
function recordSavingsSnapshot(settings,nextAmount,previousAmount){
  const curM=td().slice(0,7);
  const today=td();
  const next=+nextAmount||0;
  const previous=+previousAmount||0;
  settings.savingsPrevious=previous;
  const history=savingsSnapshots(settings);
  if(!history.some(entry=>entry.month===curM)){
    history.push({id:uid(),date:today,month:curM,amount:previous});
  }
  const monthCount=history.filter(entry=>entry.month===curM).length;
  const last=history[history.length-1];
  if(last&&last.month===curM&&last.date===today&&monthCount>1){
    last.amount=next;
  } else if(!last||last.month!==curM||Math.abs((+last.amount||0)-next)>0.009){
    history.push({id:uid(),date:today,month:curM,amount:next});
  }
  settings.savings=next;
  settings.savingsHistory=history.slice(-72);
}
function dueAlertLeadDays(settings){
  return Math.max(1,Math.min(30,+settings?.dueAlertDays||+settings?.reminderLeadDays||7));
}
function dueAlertLevel(diff, leadDays=7){
  if(diff<0) return {key:'overdue',tone:'urgent',label:`Overdue ${Math.abs(diff)}d`};
  if(diff===0) return {key:'today',tone:'urgent',label:'Due today'};
  if(diff<=Math.min(3,leadDays)) return {key:'soon',tone:'warn',label:`Due in ${diff}d`};
  return {key:'upcoming',tone:'notice',label:`Due in ${diff}d`};
}
function dueAlertItem(type,id,name,amount,dueDate,source='',leadDays=7){
  const due=normalizeDateInput(dueDate);
  if(!due) return null;
  const d=new Date(due+'T00:00:00');
  if(Number.isNaN(d.getTime())) return null;
  const today=new Date();
  today.setHours(0,0,0,0);
  const diff=Math.round((d-today)/86400000);
  if(diff>leadDays) return null;
  const meta=dueAlertLevel(diff,leadDays);
  return {
    id:`${type}:${id||name||due}`,
    type,
    panel:type==='loan'?'loans':'subscriptions',
    name:name||type,
    amount:+amount||0,
    dueDate:due,
    diff,
    level:meta.key,
    tone:meta.tone,
    levelLabel:meta.label,
    typeLabel:type==='loan'?'Loan':'Bill',
    source:(source||'').trim(),
    dateLabel:d.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
  };
}
function collectDueAlerts(store){
  const leadDays=dueAlertLeadDays(store?.settings||{});
  const items=[];
  (store.subscriptions||[]).forEach(sub=>{
    if(!sub||sub.status!=='active'||sub.paid) return;
    const next=subscriptionNextDue(sub);
    const due=next?toLocalYmd(next):'';
    const item=dueAlertItem('subscription',sub.id,sub.name,+sub.amount||0,due,sub.source||sub.cycle||'',leadDays);
    if(item) items.push(item);
  });
  (store.loans||[]).forEach(loan=>{
    if(!loan||loan.status==='paid'||(+loan.balance||0)<=0) return;
    const legacyDue=loan.due?nextDueDate(loan.due):null;
    const due=normalizeDateInput(loan.dueDate)||(legacyDue?toLocalYmd(legacyDue):'');
    const item=dueAlertItem('loan',loan.id,loan.name,+loan.monthly||+loan.balance||0,due,'',leadDays);
    if(item) items.push(item);
  });
  return items.sort((a,b)=>a.diff-b.diff||b.amount-a.amount||a.name.localeCompare(b.name));
}
function summarizeDueAlerts(alerts){
  return alerts.reduce((summary,item)=>{
    summary.total+=1;
    if(item.diff<0) summary.overdue+=1;
    else if(item.diff===0) summary.today+=1;
    else if(item.level==='soon') summary.soon+=1;
    else summary.upcoming+=1;
    return summary;
  },{total:0,overdue:0,today:0,soon:0,upcoming:0});
}
function dueStatusState(summary){
  if(summary.overdue) return {tone:'urgent',label:`${summary.overdue} overdue${summary.today?` · ${summary.today} today`:''}`};
  if(summary.today) return {tone:'warn',label:`${summary.today} due today`};
  if(summary.total) return {tone:'notice',label:`${summary.total} due soon`};
  return {tone:'ok',label:'All caught up'};
}
function updateDueStatus(){
  const el=document.getElementById('due-status');
  if(!el) return;
  const store=gs();
  const leadDays=dueAlertLeadDays(store.settings);
  const alerts=collectDueAlerts(store);
  const summary=summarizeDueAlerts(alerts);
  const state=dueStatusState(summary);
  el.textContent=state.label;
  el.className=`due-status ${state.tone}`;
  el.title=alerts.length
    ? `${summary.overdue} overdue, ${summary.today} due today, ${summary.soon+summary.upcoming} due within ${leadDays} days`
    : `No loan or subscription due within ${leadDays} days`;
}
function renderOverviewDueAlerts(store){
  const root=document.getElementById('ov-alerts');
  if(!root) return;
  const leadDays=dueAlertLeadDays(store?.settings||{});
  const alerts=collectDueAlerts(store);
  const summary=summarizeDueAlerts(alerts);
  if(!alerts.length){
    root.innerHTML=`<div class="card due-alert-card due-alert-card-clear">
      <div class="due-alert-header">
        <div>
          <div class="card-title">Due Ping</div>
          <div class="due-alert-note">No loans or subscriptions are due in the next ${leadDays} days.</div>
        </div>
        <div class="due-pill ok">All clear</div>
      </div>
    </div>`;
    return;
  }
  const pills=[
    summary.overdue?`<span class="due-pill urgent">${summary.overdue} overdue</span>`:'',
    summary.today?`<span class="due-pill warn">${summary.today} today</span>`:'',
    (summary.soon+summary.upcoming)?`<span class="due-pill notice">${summary.soon+summary.upcoming} within ${leadDays}d</span>`:''
  ].join('');
  const intro=summary.overdue
    ? 'Handle the overdue items first so this month stays clean.'
    : summary.today
      ? 'You have items due today. Logging payments here will keep the list updated.'
      : `These items are coming up within the next ${leadDays} days.`;
  root.innerHTML=`<div class="card due-alert-card ${summary.overdue?'urgent':summary.today?'warn':'notice'}">
    <div class="due-alert-header">
      <div>
        <div class="card-title">Due Ping</div>
        <div class="due-alert-note">${intro}</div>
      </div>
      <div class="due-alert-pills">${pills}</div>
    </div>
    <div class="due-alert-list">
      ${alerts.slice(0,5).map(item=>`<div class="due-item ${item.tone}">
        <div class="due-item-copy">
          <div class="due-item-top">
            <span class="due-item-name">${item.name}</span>
            <span class="due-item-kind">${item.typeLabel}</span>
          </div>
          <div class="due-item-meta">${item.levelLabel} · ${item.dateLabel}${item.source?` · ${item.source}`:''}</div>
        </div>
        <div class="due-item-amount">${P(item.amount)}</div>
      </div>`).join('')}
    </div>
    ${alerts.length>5?`<div class="due-alert-foot">+${alerts.length-5} more item${alerts.length-5===1?'':'s'} on the Loans and Subscriptions pages.</div>`:''}
  </div>`;
}
function maybeToastDuePing(){
  const store=gs();
  const alerts=collectDueAlerts(store);
  const summary=summarizeDueAlerts(alerts);
  const key=`${summary.overdue}:${summary.today}:${summary.soon}:${summary.upcoming}`;
  if(sessionStorage.getItem(DUE_PING_SESSION_KEY)===key) return;
  sessionStorage.setItem(DUE_PING_SESSION_KEY,key);
  if(!alerts.length) return;
  if(summary.overdue){
    toast(`${summary.overdue} overdue item${summary.overdue===1?'':'s'} need attention`,'var(--red)');
    return;
  }
  if(summary.today){
    toast(`${summary.today} item${summary.today===1?'':'s'} due today`,'var(--amber)');
    return;
  }
  toast(`${summary.total} item${summary.total===1?'':'s'} due within ${dueAlertLeadDays(store.settings)} days`,'var(--blue)');
}
function applySettingsFromForm(s){
  const previousSavings=+document.getElementById('s-save-prev')?.value||0;
  const nextSavings=+document.getElementById('s-save')?.value||0;
  s.settings.name=document.getElementById('s-name')?.value||'Cheri';
  s.settings.rate=+document.getElementById('s-rate')?.value||59.891;
  s.settings.balance=nextSavings;
  recordSavingsSnapshot(s.settings,nextSavings,previousSavings);
  s.settings.dueAlertDays=dueAlertLeadDays(s.settings);
}
function normalizeRangeValues(start,end){
  let s=start||'';
  let e=end||s;
  if(s&&e&&s>e) [s,e]=[e,s];
  return {start:s,end:e};
}
function getEntryRange(item){
  const rawStart=item?.startDate||item?.dateStart||item?.date||item?.paidDate||'';
  const rawEnd=item?.endDate||item?.dateEnd||item?.startDate||item?.dateStart||item?.date||item?.paidDate||'';
  const start=normalizeDateInput(rawStart);
  const end=normalizeDateInput(rawEnd)||start;
  return normalizeRangeValues(start,end);
}
function monthBounds(monthStr){
  if(!monthStr||!/^\d{4}-\d{2}$/.test(monthStr)) return {start:'',end:''};
  const [y,m]=monthStr.split('-').map(Number);
  const lastDay=String(new Date(y,m,0).getDate()).padStart(2,'0');
  return {start:`${monthStr}-01`,end:`${monthStr}-${lastDay}`};
}
function entryInMonth(item,monthStr){
  const {start,end}=getEntryRange(item);
  const {start:mStart,end:mEnd}=monthBounds(monthStr);
  return rangesOverlap(start,end,mStart,mEnd);
}
function normalizeDateInput(v){
  const raw=(v||'').trim();
  if(!raw) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d=new Date(raw);
  if(Number.isNaN(d.getTime())) return '';
  return toLocalYmd(d);
}
function rangesOverlap(entryStart,entryEnd,filterStart,filterEnd){
  if(!entryStart) return false;
  if(filterStart&&entryEnd<filterStart) return false;
  if(filterEnd&&entryStart>filterEnd) return false;
  return true;
}
function fmtRangeShort(start,end){
  if(!start) return '—';
  const s=start.slice(5).replace('-','/');
  if(!end||end===start) return s;
  return `${s} - ${end.slice(5).replace('-','/')}`;
}
function fmtDateLong(dateStr){
  const normalized=normalizeDateInput(dateStr);
  if(!normalized) return '—';
  const d=new Date(normalized+'T00:00:00');
  if(Number.isNaN(d.getTime())) return normalized;
  return d.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
}
function upworkStatus(log){
  return log?.status==='pending' ? 'pending' : 'paid';
}
function budgetPayments(line){
  return (Array.isArray(line?.payments)?line.payments:[])
    .map((payment,index)=>({
      id:payment?.id||`legacy-${index}`,
      date:normalizeDateInput(payment?.date||payment?.paidDate||''),
      amount:+payment?.amount||0,
      notes:(payment?.notes||'').trim()
    }))
    .filter(payment=>payment.date && payment.amount>0);
}
function budgetPaidAmount(line){
  const payments=budgetPayments(line);
  if(payments.length) return payments.reduce((sum,payment)=>sum+(+payment.amount||0),0);
  return line?.paid?(+line.amount||0):0;
}
function budgetLastPaidDate(line){
  const dates=budgetPayments(line).map(payment=>payment.date).sort();
  if(dates.length) return dates[dates.length-1];
  return normalizeDateInput(line?.paidDate)||normalizeDateInput(line?.date)||'';
}
function budgetRemainingAmount(line){
  return Math.max(0,(+line?.amount||0)-budgetPaidAmount(line));
}
function budgetOverAmount(line){
  return Math.max(0,budgetPaidAmount(line)-(+line?.amount||0));
}
function budgetStatusMeta(line){
  const target=+line?.amount||0;
  const paid=budgetPaidAmount(line);
  const hasPayments=budgetPayments(line).length>0;
  if(hasPayments){
    if(paid<=0) return {label:'Unpaid',chip:'chip-a'};
    if(target>0 && paid+0.009<target) return {label:'Partial',chip:'chip-b'};
    if(target>0 && paid>target+0.009) return {label:'Over budget',chip:'chip-r'};
    return {label:'Paid',chip:'chip-g'};
  }
  return line?.paid ? {label:'Paid',chip:'chip-g'} : {label:'Unpaid',chip:'chip-a'};
}
function syncBudgetLinePayments(line){
  const payments=budgetPayments(line);
  line.payments=payments;
  if(payments.length){
    const totalPaid=payments.reduce((sum,payment)=>sum+(+payment.amount||0),0);
    const target=+line.amount||0;
    line.paid=target>0 ? totalPaid+0.009>=target : totalPaid>0;
    line.paidDate=line.paid ? (payments.map(payment=>payment.date).sort().pop()||'') : '';
  } else if(!line.paid){
    line.paidDate='';
  }
  return line;
}
function budgetLoggedExpenseTxs(store){
  return (store.transactions||[]).filter(t=>t&&t.type==='expense'&&t.budgetPayment);
}
function paidBudgetAsExpenses(store){
  const loggedPaymentIds=new Set(budgetLoggedExpenseTxs(store).map(t=>String(t.budgetPaymentId||'')));
  return (store.budgetLines||[])
    .flatMap(line=>{
      const payments=budgetPayments(line);
      if(payments.length){
        return payments.filter(payment=>!loggedPaymentIds.has(String(payment.id))).map(payment=>({
          type:'expense',
          amount:+payment.amount||0,
          cat:line.cat||line.name||'BUDGET',
          desc:payment.notes?`${line.name||'Budget line'} - ${payment.notes}`:`${line.name||'Budget line'} payment`,
          notes:payment.notes||'',
          date:payment.date,
          startDate:payment.date,
          endDate:payment.date
        }));
      }
      if(!line?.paid) return [];
      const date=normalizeDateInput(line.paidDate)||normalizeDateInput(line.date)||'';
      return [{
        type:'expense',
        amount:+line.amount||0,
        cat:line.cat||line.name||'BUDGET',
        desc:`${line.name||'Budget line'} (paid bill)`,
        date,
        startDate:date,
        endDate:date
      }];
    })
    .filter(entry=>(+entry.amount||0)>0);
}
function paidSubscriptionsAsExpenses(store){
  return (store.subscriptions||[])
    .filter(s=>s&&s.paid)
    .map(s=>{
      const date=normalizeDateInput(s.paidDate)||normalizeDateInput(s.date)||'';
      return {
        type:'expense',
        amount:+s.amount||0,
        cat:s.cat||s.name||'SUBSCRIPTION',
        desc:`${s.name||'Subscription'} (paid)`,
        date,
        startDate:date,
        endDate:date
      };
    })
    .filter(t=>(+t.amount||0)>0);
}
function isLoanSettled(loan){
  if(!loan) return false;
  const status=(loan.status||'').toLowerCase();
  const bal=+loan.balance||0;
  return status==='paid'||bal<=0;
}
function inferLoanPaidDate(loan, txs){
  return (txs||[])
    .filter(t=>{
      if(!t||t.type!=='expense') return false;
      if(loan?.id&&t.loanId===loan.id) return true;
      const loanName=(loan?.name||'').trim().toLowerCase();
      const cat=(t.cat||'').trim().toLowerCase();
      return !!loanName&&cat===loanName;
    })
    .map(t=>{
      const {start,end}=getEntryRange(t);
      return end||start||'';
    })
    .filter(Boolean)
    .sort()
    .pop()||'';
}
function paidLoansAsExpenses(store){
  const loans=store?.loans||[];
  const txs=store?.transactions||[];
  return loans
    .filter(isLoanSettled)
    .map(l=>{
      const total=+l.total||0;
      const balance=+l.balance||0;
      const amount=total>0?total:Math.max(0,total-balance);
      const date=normalizeDateInput(l.paidDate)||inferLoanPaidDate(l,txs)||'';
      return {
        type:'expense',
        amount,
        cat:l.name||'LOAN',
        desc:`${l.name||'Loan'} (paid)`,
        date,
        startDate:date,
        endDate:date
      };
    })
    .filter(t=>(+t.amount||0)>0);
}
function inDateRange(date,start,end){
  return rangesOverlap(date,date,start,end);
}
function normalizeDateRange(startId,endId){
  const sEl=document.getElementById(startId);
  const eEl=document.getElementById(endId);
  let start=sEl?.value||'';
  let end=eEl?.value||'';
  if(start&&end&&start>end){
    [start,end]=[end,start];
    if(sEl) sEl.value=start;
    if(eEl) eEl.value=end;
  }
  return {start,end};
}

// ─── TOAST ──────────────────────────────────────────
function toast(msg, col='var(--green)') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0"></span>${msg}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 2800);
}

// ─── CONFIRM ────────────────────────────────────────
function askConfirm(cb, actionLabel='Delete') {
  document.getElementById('m-confirm').classList.add('open');
  const okBtn=document.getElementById('m-confirm-ok');
  okBtn.textContent=actionLabel;
  okBtn.onclick = () => { closeM('m-confirm'); cb(); };
}

// ─── CHARTS REGISTRY ────────────────────────────────
const CH = {};
function killChart(id) { if(CH[id]){CH[id].destroy();delete CH[id];} }
Chart.defaults.color = '#8a8a96';
Chart.defaults.borderColor = 'rgba(20,20,30,0.06)';
Chart.defaults.font.family = 'Space Grotesk';
Chart.defaults.font.size = 11;
const CLR = ['#3d8b5f','#4a72b5','#a87a2c','#a85a8e','#3a8a82','#6b56a8','#b54a5e','#8a8a96'];

// ─── MODAL HELPERS ───────────────────────────────────
function closeM(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if(e.target===o&&o.id!=='m-unlock') o.classList.remove('open'); }));

// ─── NAV ─────────────────────────────────────────────
const META = {
  overview:['Overview','Budget at a glance'],
  transactions:['Transactions','Log & manage all entries'],
  loans:['Loans','Track liabilities & payments'],
  subscriptions:['Subscriptions','Recurring monthly & yearly bills'],
  income:['Income','All salary & earnings'],
  budget:['Budget Lines','Plan vs actual spending'],
  upwork:['Upwork Log','Freelance hours & earnings'],
  settings:['Settings','Preferences & data'],
};

function getInitialPanel(){
  const urlPanel=(new URLSearchParams(window.location.search).get('panel')||'').trim().toLowerCase();
  if(urlPanel && META[urlPanel]) return urlPanel;
  const tabPanel=(window.name||'').startsWith(PANEL_TAB_PREFIX)?window.name.slice(PANEL_TAB_PREFIX.length):'';
  if(tabPanel && META[tabPanel]) return tabPanel;
  return sessionStorage.getItem(PANEL_KEY)||'overview';
}

function toggleSidebar(force){
  const shouldOpen = typeof force==='boolean' ? force : !document.body.classList.contains('menu-open');
  document.body.classList.toggle('menu-open', shouldOpen);
}

function closeSidebar(){
  toggleSidebar(false);
}

function syncResponsiveShell(){
  if(window.innerWidth>840) closeSidebar();
}

function nav(el) {
  const p = el?.dataset?.panel||'overview';
  if(!META[p]) return;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const navEl=document.querySelector(`.nav-item[data-panel="${p}"]`);
  if(navEl) navEl.classList.add('active');
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  document.getElementById('panel-'+p).classList.add('active');
  document.getElementById('pageTitle').textContent = META[p][0];
  document.getElementById('pageSub').textContent = META[p][1];
  document.body.dataset.panel=p;
  sessionStorage.setItem(PANEL_KEY,p);
  window.name=`${PANEL_TAB_PREFIX}${p}`;
  const url=new URL(window.location.href);
  if(p==='overview') url.searchParams.delete('panel');
  else url.searchParams.set('panel',p);
  window.history.replaceState({},'',url);
  closeSidebar();
  renderP(p);
}
function curPanel() { return (document.querySelector('.nav-item.active')||{}).dataset?.panel||'overview'; }
function renderP(p) {
  ({overview:renderOverview,transactions:renderTx,loans:renderLoans,subscriptions:renderSubs,income:renderIncome,budget:renderBudget,upwork:renderUpwork,settings:renderSettings})[p]?.();
  updateDueStatus();
}

// ─── TRANSACTIONS ─────────────────────────────────────
let txPg = 1;
const TXPP = 20;

function openTxModal(forceType) {
  document.getElementById('m-tx-title').textContent = 'Log Entry';
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-date-start').value = td();
  document.getElementById('tx-date-end').value = '';
  document.getElementById('tx-amt').value = '';
  document.getElementById('tx-desc').value = '';
  document.getElementById('tx-cat').value = '';
  document.getElementById('tx-notes').value = '';
  document.getElementById('tx-source').value = '';
  clearTxImg();
  if(forceType) document.getElementById('tx-type').value = forceType;
  refreshTxCats(); refreshSourceList();
  document.getElementById('m-tx').classList.add('open');
}

function refreshSourceList(){
  const dl=document.getElementById('source-list'); if(!dl) return;
  const sources=[...new Set((gs().transactions||[]).map(t=>t.source).filter(Boolean))].sort();
  dl.innerHTML=sources.map(s=>`<option value="${s}">`).join('');
}

function validateHttpImageUrl(raw){
  if(!raw) return '';
  try{
    const u=new URL(raw.trim());
    if(!['http:','https:'].includes(u.protocol)) return '';
    return u.href;
  }catch{
    return '';
  }
}

function trySetImageFromUrl(raw, setFn){
  const url=validateHttpImageUrl(raw);
  if(!url){toast('Please enter a valid image link','var(--red)');return;}
  const probe=new Image();
  probe.onload=()=>{setFn(url);toast('Image link identified');};
  probe.onerror=()=>toast('Could not load image from link','var(--red)');
  probe.src=url;
}

function clearTxImg(){
  document.getElementById('tx-img-data').value='';
  document.getElementById('tx-img-thumb').src='';
  document.getElementById('tx-img-preview').style.display='none';
  document.getElementById('tx-img-empty').style.display='flex';
  document.getElementById('tx-img-file').value='';
  const url=document.getElementById('tx-img-url'); if(url) url.value='';
}

function setTxImg(dataUrl){
  document.getElementById('tx-img-data').value=dataUrl;
  document.getElementById('tx-img-thumb').src=dataUrl;
  document.getElementById('tx-img-preview').style.display='flex';
  document.getElementById('tx-img-empty').style.display='none';
  const url=document.getElementById('tx-img-url');
  if(url) url.value=/^https?:\/\//i.test(dataUrl)?dataUrl:'';
}

function handleTxImg(e){
  const f=e.target.files[0]; if(!f) return;
  if(f.size>5*1024*1024){toast('Image too large (max 5MB)','var(--red)');return;}
  const r=new FileReader();
  r.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const max=200; let w=img.width,h=img.height;
      if(w>h){if(w>max){h=h*max/w;w=max;}}else{if(h>max){w=w*max/h;h=max;}}
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      setTxImg(cv.toDataURL('image/jpeg',0.82));
    };
    img.src=ev.target.result;
  };
  r.readAsDataURL(f);
}

function applyTxImgUrl(){
  const raw=document.getElementById('tx-img-url')?.value||'';
  trySetImageFromUrl(raw,setTxImg);
}

function refreshTxCats() {
  const type = document.getElementById('tx-type').value;
  const store = gs();
  const preset = store.categories[type]||[];
  const used = (store.transactions||[]).filter(t=>t.type===type).map(t=>t.cat).filter(Boolean);
  const cats = [...new Set([...preset, ...used])].sort();
  const dl = document.getElementById('tx-cat-list');
  if(dl) dl.innerHTML = cats.map(c=>`<option value="${c}">`).join('');
}

function editTx(id) {
  const store = gs();
  const tx = store.transactions.find(t=>t.id===id); if(!tx) return;
  const {start,end}=getEntryRange(tx);
  document.getElementById('m-tx-title').textContent = 'Edit Entry';
  document.getElementById('tx-id').value = id;
  document.getElementById('tx-type').value = tx.type;
  refreshTxCats();
  document.getElementById('tx-date-start').value = start;
  document.getElementById('tx-date-end').value = end&&end!==start?end:'';
  document.getElementById('tx-amt').value = tx.amount;
  document.getElementById('tx-desc').value = tx.desc;
  document.getElementById('tx-cat').value = tx.cat;
  document.getElementById('tx-notes').value = tx.notes||'';
  document.getElementById('tx-source').value = tx.source||'';
  if(tx.image) setTxImg(tx.image); else clearTxImg();
  refreshSourceList();
  document.getElementById('m-tx').classList.add('open');
}

function saveTx() {
  const id = document.getElementById('tx-id').value;
  const rawStart=document.getElementById('tx-date-start').value||td();
  const rawEnd=document.getElementById('tx-date-end').value||'';
  const {start:startDate,end:endDate}=normalizeRangeValues(rawStart,rawEnd||rawStart);
  const type=document.getElementById('tx-type').value;
  const source=document.getElementById('tx-source').value.trim();
  const rawCat=document.getElementById('tx-cat').value.trim();
  const fallbackCat=rawCat||(type==='income'?'OTHER INCOME':'OTHER');
  const rawDesc=document.getElementById('tx-desc').value.trim();
  const fallbackDesc=rawDesc||(source?`${type==='income'?'Income':'Expense'} - ${source}`:`${type==='income'?'Income':'Expense'} entry`);
  const store = gs();
  const previousTx=id?store.transactions.find(x=>x.id===id):null;
  const t = {
    id: id||uid(), type,
    date:startDate, startDate, endDate, amount:+document.getElementById('tx-amt').value,
    desc:fallbackDesc, cat:fallbackCat,
    notes:document.getElementById('tx-notes').value,
    source,
    image:document.getElementById('tx-img-data').value||''
  };
  if(previousTx?.budgetPayment&&type==='expense'){
    t.budgetPayment=true;
    t.budgetLineId=previousTx.budgetLineId;
    t.budgetPaymentId=previousTx.budgetPaymentId;
  }
  if(!t.amount){toast('Amount is required','var(--red)');return;}
  if(!store.categories[t.type].includes(t.cat)) store.categories[t.type].push(t.cat);
  if(id){const i=store.transactions.findIndex(x=>x.id===id);if(i>-1)store.transactions[i]=t;}
  else store.transactions.unshift(t);
  if(previousTx?.budgetPayment){
    const line=store.budgetLines.find(entry=>entry.id===previousTx.budgetLineId);
    if(line){
      if(t.budgetPayment){
        line.payments=budgetPayments(line).map(payment=>payment.id===previousTx.budgetPaymentId?{...payment,date:startDate,amount:t.amount,notes:t.notes||payment.notes||''}:payment);
      } else {
        line.payments=budgetPayments(line).filter(payment=>payment.id!==previousTx.budgetPaymentId);
      }
      syncBudgetLinePayments(line);
    }
  }
  ss(store); closeM('m-tx'); toast(id?'Entry updated':'Entry logged'); renderP(curPanel());
}

function delTx(id) { askConfirm(()=>{ const s=gs(); const tx=s.transactions.find(t=>t.id===id); if(tx?.budgetPayment){const line=s.budgetLines.find(entry=>entry.id===tx.budgetLineId); if(line){line.payments=budgetPayments(line).filter(payment=>payment.id!==tx.budgetPaymentId); syncBudgetLinePayments(line);}} s.transactions=s.transactions.filter(t=>t.id!==id); ss(s); toast('Deleted','var(--amber)'); renderP(curPanel()); }); }

function renderTx() {
  const store = gs();
  const typeF = document.getElementById('tf-type')?.value||'';
  const catF = document.getElementById('tf-cat')?.value||'';
  const srch = (document.getElementById('tf-search')?.value||'').toLowerCase();
  const {start:startF,end:endF}=normalizeDateRange('tf-start','tf-end');
  const sort = document.getElementById('tf-sort')?.value||'date-desc';
  const allCats = [...new Set(store.transactions.map(t=>t.cat).filter(Boolean))].sort();
  const cs = document.getElementById('tf-cat');
  if(cs){ const cur=cs.value; cs.innerHTML='<option value="">All categories</option>'+allCats.map(c=>`<option value="${c}"${c===cur?' selected':''}>${c}</option>`).join(''); }
  let txs = store.transactions.filter(t=>{
    const {start,end}=getEntryRange(t);
    const cat = t.cat||'';
    return (!typeF||t.type===typeF)&&(!catF||cat===catF)&&(!srch||t.desc.toLowerCase().includes(srch)||cat.toLowerCase().includes(srch))&&rangesOverlap(start,end,startF,endF);
  });
  txs.sort((a,b)=>{
    const ra=getEntryRange(a), rb=getEntryRange(b);
    return sort==='date-desc'?rb.start.localeCompare(ra.start):sort==='date-asc'?ra.start.localeCompare(rb.start):sort==='amt-desc'?b.amount-a.amount:a.amount-b.amount;
  });
  const vis = txs.slice(0,txPg*TXPP);
  const incomeTotal=txs.filter(t=>t.type==='income').reduce((a,t)=>a+(+t.amount||0),0);
  const expenseTotal=txs.filter(t=>t.type==='expense').reduce((a,t)=>a+(+t.amount||0),0);
  const rangePairs=txs.map(getEntryRange).filter(r=>r.start).sort((a,b)=>a.start.localeCompare(b.start));
  const lastRange=rangePairs[rangePairs.length-1];
  const rangeNote=rangePairs.length?`${fmtRangeShort(rangePairs[0].start,rangePairs[0].end)} → ${fmtRangeShort(lastRange.start,lastRange.end)}`:'No matching range';
  const txSummary=document.getElementById('tx-summary');
  if(txSummary){
    txSummary.innerHTML=`
      <div class="stat-card b"><span class="stat-card-label">Matching entries</span><strong class="stat-card-value">${txs.length.toLocaleString('en-PH')}</strong><span class="stat-card-note">Showing ${vis.length} on screen</span></div>
      <div class="stat-card g"><span class="stat-card-label">Income total</span><strong class="stat-card-value">${P(incomeTotal)}</strong><span class="stat-card-note">${typeF==='expense'?'Income is filtered out':'Across current filters'}</span></div>
      <div class="stat-card r"><span class="stat-card-label">Expense total</span><strong class="stat-card-value">${P(expenseTotal)}</strong><span class="stat-card-note">${typeF==='income'?'Expenses are filtered out':'Across current filters'}</span></div>
      <div class="stat-card a"><span class="stat-card-label">Net flow</span><strong class="stat-card-value">${signedPeso(incomeTotal-expenseTotal)}</strong><span class="stat-card-note">${rangeNote}</span></div>`;
  }
  const el = document.getElementById('tx-body'); if(!el) return;
  el.innerHTML = !txs.length ? `<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No entries found</div></div>` :
    vis.map(t=>{
      const {start,end}=getEntryRange(t);
      const thumb = t.image ? `<img class="tx-thumb" src="${t.image}" alt="">` : `<span class="tx-thumb-fallback">${(t.source||t.desc||'?').trim().charAt(0).toUpperCase()}</span>`;
      return `<div class="tbl-row tbl-row-tx">
      <div class="tbl-cell tbl-cell-mono" data-label="Date" style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted)">${fmtRangeShort(start,end)}</div>
      <div class="tbl-cell tbl-cell-primary" data-label="Description"><div class="tx-desc-wrap">${thumb}<div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.desc}</div>${t.source?`<div class="tx-source-tag">${t.source}</div>`:t.notes?`<div style="font-size:11px;color:var(--muted)">${t.notes}</div>`:''}</div></div></div>
      <div class="tbl-cell" data-label="Category"><span class="chip chip-m" style="font-size:10px;padding:2px 6px">${t.cat}</span></div>
      <div class="tbl-cell tbl-cell-mono" data-label="Amount" style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:var(--${t.type==='income'?'green':'red'})">${t.type==='income'?'+':'-'}${P(t.amount)}</div>
      <div class="tbl-cell" data-label="Type"><span class="chip ${t.type==='income'?'chip-g':'chip-r'}" style="font-size:10px;padding:2px 6px">${t.type}</span></div>
      <div class="tbl-cell tbl-actions" data-label="Actions" style="display:flex;gap:4px;justify-content:flex-end">
        <button class="icon-btn edt" onclick="editTx('${t.id}')" title="Edit"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn dlt dng" onclick="delTx('${t.id}')" title="Delete"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>`}).join('');
  const lm=document.getElementById('tx-more'); if(lm) lm.style.display=txs.length>txPg*TXPP?'block':'none';
}

// ─── LOANS ────────────────────────────────────────────
function openLoanModal(id) {
  document.getElementById('m-loan-title').textContent = id?'Edit Loan':'Add Loan';
  document.getElementById('ln-id').value = id||'';
  if(id){
    const l=gs().loans.find(x=>x.id===id);
    if(l){
      const legacyDue=l.due?nextDueDate(l.due):null;
      const dueDate=l.dueDate||(legacyDue?legacyDue.toISOString().slice(0,10):'');
      document.getElementById('ln-name').value=l.name;
      document.getElementById('ln-total').value=l.total;
      document.getElementById('ln-bal').value=l.balance;
      document.getElementById('ln-mo').value=l.monthly;
      document.getElementById('ln-due-date').value=dueDate;
      document.getElementById('ln-notes').value=l.notes||'';
      document.getElementById('ln-status').value=l.status;
    }
  } else {
    ['ln-name','ln-total','ln-bal','ln-mo','ln-due-date','ln-notes'].forEach(x=>document.getElementById(x).value='');
    document.getElementById('ln-status').value='active';
  }
  document.getElementById('m-loan').classList.add('open');
}
function saveLoan() {
  const id=document.getElementById('ln-id').value;
  const s=gs();
  const existing=id?s.loans.find(x=>x.id===id):null;
  const status=document.getElementById('ln-status').value;
  let paidDate='';
  if(status==='paid'){
    if(existing?.status==='paid') paidDate=normalizeDateInput(existing?.paidDate)||'';
    else paidDate=td();
  }
  const l={id:id||uid(),name:document.getElementById('ln-name').value,total:+document.getElementById('ln-total').value,balance:+document.getElementById('ln-bal').value,monthly:+document.getElementById('ln-mo').value,dueDate:document.getElementById('ln-due-date').value,notes:document.getElementById('ln-notes').value,status,paidDate};
  if(!l.name||!l.total){toast('Fill required fields','var(--red)');return;}
  if(id){const i=s.loans.findIndex(x=>x.id===id);if(i>-1)s.loans[i]=l;}else s.loans.push(l);
  ss(s); closeM('m-loan'); toast(id?'Loan updated':'Loan added'); renderLoans();
}
function delLoan(id){askConfirm(()=>{const s=gs();s.loans=s.loans.filter(l=>l.id!==id);ss(s);toast('Removed','var(--amber)');renderLoans();});}

function openLoanPay(id){
  const l=gs().loans.find(x=>x.id===id); if(!l)return;
  document.getElementById('m-lp-title').textContent='Log Payment - '+l.name;
  document.getElementById('lp-lid').value=id;
  document.getElementById('lp-date-start').value=td();
  document.getElementById('lp-date-end').value=td();
  document.getElementById('lp-amt').value=l.monthly||'';
  document.getElementById('lp-int').value='';
  document.getElementById('lp-notes').value='';
  document.getElementById('m-lp').classList.add('open');
}
function saveLoanPayment(){
  const lid=document.getElementById('lp-lid').value;
  const amt=+document.getElementById('lp-amt').value;
  const intr=+document.getElementById('lp-int').value||0;
  const {start:startDate,end:endDate}=normalizeRangeValues(document.getElementById('lp-date-start').value,document.getElementById('lp-date-end').value);
  const notes=document.getElementById('lp-notes').value;
  if(!amt||!startDate){toast('Fill required fields','var(--red)');return;}
  const s=gs();
  const li=s.loans.findIndex(l=>l.id===lid);
  if(li>-1){
    s.loans[li].balance=Math.max(0,(+s.loans[li].balance||0)-amt);
    if(s.loans[li].balance===0){
      s.loans[li].status='paid';
      if(!normalizeDateInput(s.loans[li].paidDate)) s.loans[li].paidDate=endDate||startDate||td();
    }
  }
  const lname=s.loans[li]?.name||'Loan';
  s.transactions.unshift({id:uid(),type:'expense',date:startDate,startDate,endDate,amount:amt+intr,desc:`${lname} payment${notes?' - '+notes:''}`,cat:lname,notes,loanId:lid,loanPayment:true});
  ss(s); closeM('m-lp'); toast('Payment logged - balance updated'); renderLoans();
}

function openMandModal(id) {
  document.getElementById('m-mand-title').textContent=id?'Edit Expense':'Mandatory Expense';
  document.getElementById('mand-id').value=id||'';
  if(id){const m=gs().mandatoryExpenses.find(x=>x.id===id);if(m){document.getElementById('mand-name').value=m.name;document.getElementById('mand-amt').value=m.amount;}}
  else{document.getElementById('mand-name').value='';document.getElementById('mand-amt').value='';}
  document.getElementById('m-mand').classList.add('open');
}
function saveMand(){
  const id=document.getElementById('mand-id').value;
  const item={id:id||uid(),name:document.getElementById('mand-name').value,amount:+document.getElementById('mand-amt').value};
  if(!item.name||!item.amount){toast('Fill required fields','var(--red)');return;}
  const s=gs(); if(id){const i=s.mandatoryExpenses.findIndex(m=>m.id===id);if(i>-1)s.mandatoryExpenses[i]=item;}else s.mandatoryExpenses.push(item);
  ss(s);closeM('m-mand');toast('Saved');renderLoans();
}
function delMand(id){askConfirm(()=>{const s=gs();s.mandatoryExpenses=s.mandatoryExpenses.filter(m=>m.id!==id);ss(s);toast('Removed','var(--amber)');renderLoans();});}

function renderLoans(){
  const s=gs(); const loans=s.loans;
  const totD=loans.reduce((a,l)=>a+(+l.total||0),0);
  const totB=loans.reduce((a,l)=>a+(+l.balance||0),0);
  const totM=loans.reduce((a,l)=>a+(+l.monthly||0),0);
  const active=loans.filter(l=>l.status==='active').length;
  document.getElementById('ln-metrics').innerHTML=`
    <div class="mcard r"><div class="m-label">Total Debt</div><div class="m-value r">${P(totD)}</div><div class="m-sub">All loans</div></div>
    <div class="mcard a"><div class="m-label">Outstanding</div><div class="m-value a">${P(totB)}</div><div class="m-sub">Still owed</div></div>
    <div class="mcard b"><div class="m-label">Monthly Due</div><div class="m-value b">${P(totM)}</div><div class="m-sub">Regular payments</div></div>
    <div class="mcard t"><div class="m-label">Active</div><div class="m-value t">${active}</div><div class="m-sub">Open loans</div></div>`;
  killChart('ch-loans');
  const cv=document.getElementById('ch-loans');
  if(cv) CH['ch-loans']=new Chart(cv,{type:'bar',data:{labels:loans.map(l=>l.name),datasets:[{data:loans.map(l=>+l.total),backgroundColor:loans.map(l=>l.status==='paid'?'#4ade80':l.status==='minimal'?'#fbbf24':'#f87171'),borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'₱'+Math.round(c.parsed.x).toLocaleString()}}},scales:{x:{ticks:{callback:v=>'₱'+(v/1000).toFixed(0)+'k'}}}}});
  const sc={active:'<span class="chip chip-r">Active</span>',paid:'<span class="chip chip-g">Paid</span>',minimal:'<span class="chip chip-a">Almost done</span>'};
  document.getElementById('ln-body').innerHTML=loans.map(l=>{
    const pct=l.total>0?Math.min(100,Math.round((1-(l.balance/l.total))*100)):100;
    const pc=l.status==='paid'?'var(--green)':l.status==='minimal'?'var(--amber)':'var(--red)';
    const dueTag=l.dueDate?dueDateBadge(l.dueDate):dueBadge(l.due);
    return `<div class="tbl-row tbl-row-loans">
      <div class="tbl-cell tbl-cell-primary" data-label="Name"><div><div style="font-weight:500">${l.name}</div><div style="font-size:11px;color:var(--muted)">${l.notes||''}</div><div style="margin-top:5px"><div class="prog-bg" style="width:100px"><div class="prog-fill" style="width:${pct}%;background:${pc}"></div></div></div></div></div>
      <div class="tbl-cell tbl-cell-mono" data-label="Total" style="text-align:right;font-family:'DM Mono',monospace;font-size:13px">${P(l.total)}</div>
      <div class="tbl-cell tbl-cell-mono" data-label="Balance" style="text-align:right;font-family:'DM Mono',monospace;font-size:13px;color:${l.balance>0?'var(--red)':'var(--green)'}">${P(l.balance)}</div>
      <div class="tbl-cell tbl-cell-mono" data-label="Monthly" style="text-align:right;font-family:'DM Mono',monospace;font-size:13px;color:var(--amber)">${l.monthly?P(l.monthly):'-'}</div>
      <div class="tbl-cell" data-label="Due date">${dueTag}</div>
      <div class="tbl-cell" data-label="Status">${sc[l.status]||''}</div>
      <div class="tbl-cell tbl-actions" data-label="Actions" style="display:flex;gap:3px;justify-content:flex-end">
        <button class="icon-btn" onclick="openLoanPay('${l.id}')" title="Log payment" style="color:var(--green)"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button class="icon-btn edt" onclick="openLoanModal('${l.id}')" title="Edit"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn dlt dng" onclick="delLoan('${l.id}')" title="Delete"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>`;}).join('');
  const mands=s.mandatoryExpenses; const totMand=mands.reduce((a,m)=>a+(+m.amount||0),0);
  document.getElementById('mand-body').innerHTML=mands.map(m=>`
    <div class="sum-row"><span>${m.name}</span><div style="display:flex;align-items:center;gap:8px"><span style="font-family:'DM Mono',monospace;color:var(--amber)">${P(m.amount)}</span>
    <button class="icon-btn" onclick="openMandModal('${m.id}')" style="opacity:.5"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
    <button class="icon-btn dng" onclick="delMand('${m.id}')" style="opacity:.5"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div></div>`).join('')+`<div class="sum-row" style="font-weight:600;border-top:1px solid var(--border2);padding-top:10px;margin-top:4px"><span>Total</span><span style="font-family:'DM Mono',monospace;color:var(--amber)">${P(totMand)}</span></div>`;
}

// ─── SUBSCRIPTIONS ────────────────────────────────────
function clearSubImg(){
  document.getElementById('sb-img-data').value='';
  document.getElementById('sb-img-thumb').src='';
  document.getElementById('sb-img-preview').style.display='none';
  document.getElementById('sb-img-empty').style.display='flex';
  document.getElementById('sb-img-file').value='';
  const url=document.getElementById('sb-img-url'); if(url) url.value='';
}

function setSubImg(d){
  document.getElementById('sb-img-data').value=d;
  document.getElementById('sb-img-thumb').src=d;
  document.getElementById('sb-img-preview').style.display='flex';
  document.getElementById('sb-img-empty').style.display='none';
  const url=document.getElementById('sb-img-url');
  if(url) url.value=/^https?:\/\//i.test(d)?d:'';
}

function handleSubImg(e){
  const f=e.target.files[0]; if(!f) return;
  if(f.size>5*1024*1024){toast('Image too large (max 5MB)','var(--red)');return;}
  const r=new FileReader();
  r.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const max=200; let w=img.width,h=img.height;
      if(w>h){if(w>max){h=h*max/w;w=max;}}else{if(h>max){w=w*max/h;h=max;}}
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      setSubImg(cv.toDataURL('image/jpeg',0.82));
    };
    img.src=ev.target.result;
  };
  r.readAsDataURL(f);
}

function applySubImgUrl(){
  const raw=document.getElementById('sb-img-url')?.value||'';
  trySetImageFromUrl(raw,setSubImg);
}

function openSubModal(){
  document.getElementById('m-sub-title').textContent='Add Subscription';
  ['sb-id','sb-name','sb-amt','sb-due','sb-paid-date','sb-cat','sb-source','sb-notes'].forEach(x=>document.getElementById(x).value='');
  document.getElementById('sb-cycle').value='monthly';
  document.getElementById('sb-status').value='active';
  document.getElementById('sb-paid').value='unpaid';
  clearSubImg();
  document.getElementById('m-sub').classList.add('open');
}
function editSub(id){
  const s=(gs().subscriptions||[]).find(x=>x.id===id); if(!s) return;
  document.getElementById('m-sub-title').textContent='Edit Subscription';
  document.getElementById('sb-id').value=id;
  document.getElementById('sb-name').value=s.name||'';
  document.getElementById('sb-amt').value=s.amount||'';
  document.getElementById('sb-cycle').value=s.cycle||'monthly';
  document.getElementById('sb-due').value=subscriptionAnchorDate(s);
  document.getElementById('sb-status').value=s.status||'active';
  document.getElementById('sb-paid').value=s.paid?'paid':'unpaid';
  document.getElementById('sb-paid-date').value=s.paidDate||'';
  document.getElementById('sb-cat').value=s.cat||'';
  document.getElementById('sb-source').value=s.source||'';
  document.getElementById('sb-notes').value=s.notes||'';
  if(s.image) setSubImg(s.image); else clearSubImg();
  document.getElementById('m-sub').classList.add('open');
}
function saveSub(){
  const id=document.getElementById('sb-id').value;
  const st=gs(); st.subscriptions=st.subscriptions||[];
  const existing=id?st.subscriptions.find(x=>x.id===id):null;
  const paid=document.getElementById('sb-paid').value==='paid';
  const paidDateInput=normalizeDateInput(document.getElementById('sb-paid-date').value);
  const dueDateInput=normalizeDateInput(document.getElementById('sb-due').value);
  const sub={id:id||uid(),name:document.getElementById('sb-name').value.trim(),amount:+document.getElementById('sb-amt').value,cycle:document.getElementById('sb-cycle').value,dueDate:dueDateInput,status:document.getElementById('sb-status').value,paid,paidDate:paid?(paidDateInput||normalizeDateInput(existing?.paidDate)||td()):'',cat:document.getElementById('sb-cat').value.trim(),source:document.getElementById('sb-source').value.trim(),notes:document.getElementById('sb-notes').value,image:document.getElementById('sb-img-data').value||''};
  if(!sub.name||!sub.amount){toast('Fill required fields','var(--red)');return;}
  if(id){const i=st.subscriptions.findIndex(x=>x.id===id);if(i>-1)st.subscriptions[i]=sub;}else st.subscriptions.push(sub);
  ss(st); closeM('m-sub'); toast(id?'Subscription updated':'Subscription added'); renderSubs();
}
function delSub(id){askConfirm(()=>{const s=gs();s.subscriptions=(s.subscriptions||[]).filter(x=>x.id!==id);ss(s);toast('Removed','var(--amber)');renderSubs();});}
function toggleSubPaid(id){
  const s=gs(); s.subscriptions=s.subscriptions||[];
  const i=s.subscriptions.findIndex(x=>x.id===id);
  if(i<0) return;
  if(s.subscriptions[i].paid){
    s.subscriptions[i].paid=false;
    s.subscriptions[i].paidDate='';
  } else {
    s.subscriptions[i].paid=true;
    s.subscriptions[i].paidDate=normalizeDateInput(s.subscriptions[i].paidDate)||td();
  }
  ss(s);
  toast(s.subscriptions[i].paid?'Subscription marked paid':'Subscription marked unpaid');
  renderSubs();
}

function monthlyCost(s){const a=+s.amount||0;return s.cycle==='yearly'?a/12:s.cycle==='weekly'?a*4.33:a;}

function renderSubs(){
  const st=gs(); const subs=(st.subscriptions||[]); const active=subs.filter(s=>s.status==='active');
  const totMo=active.reduce((a,s)=>a+monthlyCost(s),0);
  const totYr=totMo*12;
  const next=active.map(s=>({s,d:subscriptionNextDue(s)})).filter(x=>x.d).sort((a,b)=>a.d-b.d)[0];
  const nextLbl=next?next.s.name+' · '+next.d.toLocaleDateString('en-PH',{month:'short',day:'numeric'}):'—';
  document.getElementById('sub-metrics').innerHTML=`
    <div class="mcard p"><div class="m-label">Monthly Total</div><div class="m-value p">${P(totMo)}</div><div class="m-sub">Active subscriptions</div></div>
    <div class="mcard a"><div class="m-label">Yearly Equivalent</div><div class="m-value a">${P(totYr)}</div><div class="m-sub">Annual outflow</div></div>
    <div class="mcard b"><div class="m-label">Active</div><div class="m-value b">${active.length}</div><div class="m-sub">of ${subs.length} total</div></div>
    <div class="mcard t"><div class="m-label">Next Bill</div><div class="m-value t" style="font-size:15px">${nextLbl}</div><div class="m-sub">Coming up</div></div>`;

  const today=new Date();today.setHours(0,0,0,0);
  const upcoming=active.map(s=>{const d=subscriptionNextDue(s);if(!d)return null;const diff=Math.round((d-today)/86400000);return {s,d,diff};}).filter(Boolean).filter(x=>x.diff<=30).sort((a,b)=>a.d-b.d);
  document.getElementById('sub-upcoming').innerHTML=upcoming.length?upcoming.map(({s,d,diff})=>{
    const thumb=s.image?`<img class="tx-thumb" src="${s.image}" alt="">`:`<span class="tx-thumb-fallback">${(s.name||'?').charAt(0).toUpperCase()}</span>`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 4px;border-bottom:1px solid var(--hairline)">
      ${thumb}
      <div style="flex:1"><div style="font-weight:500">${s.name}</div><div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${s.cycle.toUpperCase()}${s.source?' · '+s.source:''}</div></div>
      <div style="text-align:right;font-family:'DM Mono',monospace;color:var(--red);font-weight:600">${P(s.amount)}</div>
      <div style="min-width:120px;text-align:right">${subscriptionDueBadge(s)}</div>
    </div>`;}).join(''):`<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No bills due in the next 30 days</div></div>`;

  const sc={active:'<span class="chip chip-g">Active</span>',paused:'<span class="chip chip-a">Paused</span>',canceled:'<span class="chip chip-m">Canceled</span>'};
  document.getElementById('sub-body').innerHTML=subs.length?subs.map(s=>{
    const thumb=s.image?`<img class="tx-thumb" src="${s.image}" alt="">`:`<span class="tx-thumb-fallback">${(s.name||'?').charAt(0).toUpperCase()}</span>`;
    return `<div class="tbl-row tbl-row-sub">
      <div class="tbl-cell tbl-cell-primary" data-label="Name"><div class="tx-desc-wrap">${thumb}<div><div style="font-weight:500">${s.name}</div><div class="tx-source-tag">${s.cat||''}${s.source?' · '+s.source:''}</div></div></div></div>
      <div class="tbl-cell tbl-cell-mono" data-label="Amount" style="text-align:right;font-family:'DM Mono',monospace;color:var(--red);font-weight:600">${P(s.amount)}</div>
      <div class="tbl-cell" data-label="Cycle"><span class="chip chip-m" style="font-size:10px;padding:2px 6px">${s.cycle}</span></div>
      <div class="tbl-cell" data-label="Next due">${subscriptionDueBadge(s)}</div>
      <div class="tbl-cell" data-label="Status">${sc[s.status]||''}</div>
      <div class="tbl-cell" data-label="Payment">${s.paid?'<span class="chip chip-g">Paid</span>':'<span class="chip chip-a">Unpaid</span>'}</div>
      <div class="tbl-cell tbl-actions" data-label="Actions" style="display:flex;gap:3px;justify-content:flex-end">
        <button class="icon-btn" onclick="toggleSubPaid('${s.id}')" title="Toggle paid/unpaid"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5h8M11 3l2 2-2 2M13 11H5M5 9l-2 2 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn edt" onclick="editSub('${s.id}')" title="Edit"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn dlt dng" onclick="delSub('${s.id}')" title="Delete"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>`;}).join(''):`<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No subscriptions yet — add one to start tracking</div></div>`;
}

// ─── INCOME ───────────────────────────────────────────
function renderIncome(){
  const s=gs();
  const {start:startF,end:endF}=normalizeDateRange('if-start','if-end');
  const txs=s.transactions.filter(t=>{
    if(t.type!=='income') return false;
    const {start,end}=getEntryRange(t);
    return rangesOverlap(start,end,startF,endF);
  }).sort((a,b)=>getEntryRange(b).start.localeCompare(getEntryRange(a).start));
  const byCat={}; txs.forEach(t=>{byCat[t.cat]=(byCat[t.cat]||0)+(+t.amount||0);});
  const sorted=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const total=sorted.reduce((a,e)=>a+e[1],0);
  const curM=td().slice(0,7);
  const mInc=txs.filter(t=>entryInMonth(t,curM)).reduce((a,t)=>a+(+t.amount||0),0);
  const rangeLbl=(startF||endF)?`${startF||'Start'} to ${endF||'End'}`:'All time';
  document.getElementById('inc-metrics').innerHTML=`
    <div class="mcard g"><div class="m-label">Total Income</div><div class="m-value g">${P(total)}</div><div class="m-sub">${rangeLbl}</div></div>
    <div class="mcard b"><div class="m-label">Sources</div><div class="m-value b">${sorted.length}</div><div class="m-sub">Categories</div></div>
    <div class="mcard a"><div class="m-label">Top Source</div><div class="m-value a" style="font-size:15px">${sorted[0]?sorted[0][0]:'-'}</div><div class="m-sub">${sorted[0]?P(sorted[0][1]):'₱0'}</div></div>
    <div class="mcard t"><div class="m-label">This Month</div><div class="m-value t">${P(mInc)}</div><div class="m-sub">${curM}</div></div>`;
  killChart('ch-inc-bar');
  const cv=document.getElementById('ch-inc-bar');
  if(cv&&sorted.length) CH['ch-inc-bar']=new Chart(cv,{type:'bar',data:{labels:sorted.map(e=>e[0]),datasets:[{data:sorted.map(e=>e[1]),backgroundColor:sorted.map((_,i)=>CLR[i%CLR.length]),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'₱'+Math.round(c.parsed.y).toLocaleString()}}},scales:{y:{ticks:{callback:v=>'₱'+(v/1000).toFixed(0)+'k'}}}}});
  document.getElementById('inc-body').innerHTML=!txs.length?`<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No income records for this date range</div></div>`:txs.slice(0,40).map(t=>{
    const {start,end}=getEntryRange(t);
    return `
    <div class="tbl-row tbl-row-inc">
      <div class="tbl-cell tbl-cell-mono" data-label="Date" style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted)">${fmtRangeShort(start,end)}</div>
      <div class="tbl-cell tbl-cell-primary" data-label="Description">${t.desc}</div>
      <div class="tbl-cell" data-label="Source"><span class="chip chip-m" style="font-size:10px;padding:2px 6px">${t.cat}</span></div>
      <div class="tbl-cell tbl-cell-mono" data-label="Amount" style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:var(--green)">+${P(t.amount)}</div>
      <div class="tbl-cell tbl-actions" data-label="Actions" style="display:flex;gap:4px;justify-content:flex-end">
        <button class="icon-btn edt" onclick="editTx('${t.id}')"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn dlt dng" onclick="delTx('${t.id}')"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

// ─── BUDGET ───────────────────────────────────────────
function openBudgetModal(id){
  document.getElementById('m-bg-title').textContent=id?'Edit Budget Line':'Add Budget Line';
  document.getElementById('bg-id').value=id||'';
  if(id){
    const l=gs().budgetLines.find(x=>x.id===id);
    if(l){
      document.getElementById('bg-name').value=l.name;
      document.getElementById('bg-amt').value=l.amount;
      document.getElementById('bg-cat').value=l.cat||'';
      document.getElementById('bg-status').value=l.paid?'paid':'unpaid';
      document.getElementById('bg-paid-date').value=l.paidDate||'';
    }
  } else {
    document.getElementById('bg-name').value='';
    document.getElementById('bg-amt').value='';
    document.getElementById('bg-cat').value='';
    document.getElementById('bg-status').value='unpaid';
    document.getElementById('bg-paid-date').value='';
  }
  document.getElementById('m-budget').classList.add('open');
}
function openBudgetPayment(id){
  const line=gs().budgetLines.find(x=>x.id===id);
  if(!line) return;
  const remaining=budgetRemainingAmount(line);
  const paid=budgetPaidAmount(line);
  document.getElementById('m-bg-pay-title').textContent='Log Expense - '+line.name;
  document.getElementById('m-bg-pay-subcopy').textContent=remaining>0
    ? `Remaining to budget: ${P(remaining)}. Enter only what you paid today.`
    : `Budget already covered by ${P(paid)}. Extra spending will show as over budget.`;
  document.getElementById('bgp-line-id').value=id;
  document.getElementById('bgp-date').value=td();
  document.getElementById('bgp-amt').value='';
  document.getElementById('bgp-amt').placeholder=remaining>0 ? F(remaining) : '0.00';
  document.getElementById('bgp-notes').value='';
  document.getElementById('m-bg-pay').classList.add('open');
}
function saveBudget(){
  const id=document.getElementById('bg-id').value;
  const s=gs();
  const existing=id?s.budgetLines.find(l=>l.id===id):null;
  const name=document.getElementById('bg-name').value.trim();
  const amount=+document.getElementById('bg-amt').value;
  const catInput=document.getElementById('bg-cat').value.trim();
  const paid=document.getElementById('bg-status').value==='paid';
  const paidDateInput=normalizeDateInput(document.getElementById('bg-paid-date').value);
  const item={id:id||uid(),name,amount,cat:catInput||name.toUpperCase(),paid,paidDate:paid?(paidDateInput||normalizeDateInput(existing?.paidDate)||td()):'',payments:budgetPayments(existing)};
  syncBudgetLinePayments(item);
  if(!item.name||!item.amount){toast('Fill required fields','var(--red)');return;}
  if(id){const i=s.budgetLines.findIndex(l=>l.id===id);if(i>-1)s.budgetLines[i]=item;}else s.budgetLines.push(item);
  ss(s);closeM('m-budget');toast('Saved');renderBudget();
}
function delBudget(id){askConfirm(()=>{const s=gs();s.budgetLines=s.budgetLines.filter(l=>l.id!==id);ss(s);toast('Removed','var(--amber)');renderBudget();});}
function saveBudgetPayment(){
  const lineId=document.getElementById('bgp-line-id').value;
  const amount=+document.getElementById('bgp-amt').value;
  const date=normalizeDateInput(document.getElementById('bgp-date').value);
  const notes=document.getElementById('bgp-notes').value.trim();
  if(!date||!amount){toast('Fill required fields','var(--red)');return;}
  const s=gs();
  const i=s.budgetLines.findIndex(line=>line.id===lineId);
  if(i<0) return;
  const line=s.budgetLines[i];
  const paymentId=uid();
  const cat=line.cat||line.name||'BUDGET';
  const desc=notes?`${line.name||'Budget line'} - ${notes}`:`${line.name||'Budget line'} payment`;
  line.payments=[...budgetPayments(line),{id:paymentId,date,amount,notes}];
  syncBudgetLinePayments(line);
  if(!s.categories.expense.includes(cat)) s.categories.expense.push(cat);
  s.transactions.unshift({
    id:uid(),
    type:'expense',
    date,
    startDate:date,
    endDate:date,
    amount,
    desc,
    cat,
    notes,
    source:'Budget Line',
    image:'',
    budgetPayment:true,
    budgetLineId:line.id,
    budgetPaymentId:paymentId
  });
  ss(s);
  closeM('m-bg-pay');
  toast('Expense logged');
  renderBudget();
}
function delBudgetPayment(lineId,paymentId){
  askConfirm(()=>{
    const s=gs();
    const line=s.budgetLines.find(entry=>entry.id===lineId);
    if(!line) return;
    line.payments=budgetPayments(line).filter(payment=>payment.id!==paymentId);
    syncBudgetLinePayments(line);
    s.transactions=(s.transactions||[]).filter(tx=>!(tx.budgetPayment&&tx.budgetLineId===lineId&&tx.budgetPaymentId===paymentId));
    ss(s);
    toast('Payment removed','var(--amber)');
    renderBudget();
  },'Remove');
}
function toggleBudgetPaid(id){
  const s=gs();
  const i=s.budgetLines.findIndex(l=>l.id===id);
  if(i<0) return;
  if(s.budgetLines[i].paid){
    s.budgetLines[i].paid=false;
    s.budgetLines[i].paidDate='';
  } else {
    s.budgetLines[i].paid=true;
    s.budgetLines[i].paidDate=normalizeDateInput(s.budgetLines[i].paidDate)||td();
  }
  ss(s);
  toast(s.budgetLines[i].paid?'Marked as paid':'Marked as unpaid');
  renderBudget();
}

function renderBudget(){
  const s=gs(); const lines=s.budgetLines||[];
  const totBg=lines.reduce((a,l)=>a+(+l.amount||0),0);
  const paidBillSpent=lines.reduce((a,l)=>a+budgetPaidAmount(l),0);
  const overspent=Math.max(0,paidBillSpent-totBg);
  const bgTotals=document.getElementById('bg-chart-totals');
  if(bgTotals){
    bgTotals.innerHTML=`
      <span class="bg-total-chip">Budgeted <strong>${P(totBg)}</strong></span>
      <span class="bg-total-chip">Logged <strong>${P(paidBillSpent)}</strong></span>
      <span class="bg-total-chip ${overspent>0?'bg-total-chip-over':''}">Overspent <strong>${P(overspent)}</strong></span>`;
  }
  killChart('ch-budget');
  const cv=document.getElementById('ch-budget');
  if(cv&&lines.length){
    const acts=lines.map(l=>budgetPaidAmount(l));
    CH['ch-budget']=new Chart(cv,{type:'bar',data:{labels:lines.map(l=>l.name),datasets:[{label:'Budget',data:lines.map(l=>+l.amount),backgroundColor:'rgba(74,114,181,.45)',borderRadius:3},{label:'Logged',data:acts,backgroundColor:lines.map(l=>{const status=budgetStatusMeta(l).label;return status==='Paid'?'rgba(61,139,95,.78)':status==='Partial'?'rgba(47,114,196,.72)':status==='Over budget'?'rgba(181,74,94,.75)':'rgba(138,138,150,.28)';}),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:'#8a8a96',boxWidth:10}}},scales:{y:{ticks:{callback:v=>'₱'+(v/1000).toFixed(0)+'k'}}}}});
  }
  document.getElementById('bg-body').innerHTML=lines.length?lines.map(l=>{
    const payments=budgetPayments(l).sort((a,b)=>b.date.localeCompare(a.date));
    const paid=budgetPaidAmount(l);
    const remaining=budgetRemainingAmount(l);
    const over=budgetOverAmount(l);
    const status=budgetStatusMeta(l);
    const pct=(+l.amount||0)>0?Math.min(100,Math.round((paid/(+l.amount||1))*100)):0;
    const lastPaidDate=budgetLastPaidDate(l);
    const paidLabel=payments.length
      ? `${payments.length} payment${payments.length>1?'s':''} logged`
      : l.paid
        ? 'Marked paid manually'
        : 'No payments logged yet';
    const paymentLog=payments.length
      ? `<div class="budget-payment-list">${payments.slice(0,3).map(payment=>`
          <div class="budget-payment-row">
            <div class="budget-payment-copy">
              <strong>${payment.notes||'Budget payment'}</strong>
              <small>${fmtDateLong(payment.date)}</small>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="budget-payment-amount">${P(payment.amount)}</span>
              <button class="icon-btn dng" onclick="delBudgetPayment('${l.id}','${payment.id}')" title="Remove payment"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </div>
          </div>`).join('')}</div>`
      : '';
    return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:8px">
        <div>
          <div style="font-weight:500">${l.name}</div>
          <div style="font-size:11px;color:var(--muted)">${l.cat||'-'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--blue)">${P(l.amount)}</span>
          <span class="chip ${status.chip}">${status.label}</span>
          <button class="btn" onclick="openBudgetPayment('${l.id}')" style="padding:5px 8px;font-size:11px">${payments.length?'Add Expense':'Log Expense'}</button>
          <button class="icon-btn" onclick="openBudgetModal('${l.id}')" style="opacity:.6"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
          <button class="icon-btn dng" onclick="delBudget('${l.id}')" style="opacity:.6"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>
      <div class="budget-line-stats">
        <span class="budget-line-stat">Paid <strong>${P(paid)}</strong></span>
        <span class="budget-line-stat">${over>0?'Over':'Remaining'} <strong>${P(over>0?over:remaining)}</strong></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);margin-bottom:6px;gap:8px">
        <span>${paidLabel}</span>
        <span>${lastPaidDate?`Last paid ${fmtDateLong(lastPaidDate)}`:'Waiting for first payment'}</span>
      </div>
      <div class="prog-bg" style="width:100%;height:5px"><div class="prog-fill" style="width:${pct}%;background:${over>0?'var(--red)':paid>0?'var(--green)':'var(--muted-2)'}"></div></div>
      ${paymentLog}
    </div>`;}).join('') : `<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No budget lines yet. Add one to start tracking.</div></div>`;
}

// ─── UPWORK ───────────────────────────────────────────
function autoUwPHP(){ const r=gs().settings.rate||59.891; document.getElementById('uw-php').value=(((+document.getElementById('uw-usd').value)||0)*r).toFixed(2); }
function openUpworkModal(id){
  document.getElementById('m-uw-title').textContent=id?'Edit Log':'Log Upwork Hours';
  document.getElementById('uw-id').value=id||'';
  if(id){
    const l=gs().upworkLogs.find(x=>x.id===id);
    if(l){
      const {start,end}=getEntryRange(l);
      document.getElementById('uw-date-start').value=start;
      document.getElementById('uw-date-end').value=end;
      document.getElementById('uw-client').value=l.client||'';
      document.getElementById('uw-hrs').value=l.hours||'';
      document.getElementById('uw-usd').value=l.usd;
      document.getElementById('uw-php').value=l.php;
      document.getElementById('uw-status').value=upworkStatus(l);
    }
  } else {
    document.getElementById('uw-date-start').value=td();
    document.getElementById('uw-date-end').value=td();
    ['uw-client','uw-hrs','uw-usd','uw-php'].forEach(x=>document.getElementById(x).value='');
    document.getElementById('uw-status').value='paid';
  }
  document.getElementById('m-uw').classList.add('open');
}
function saveUpwork(){
  const id=document.getElementById('uw-id').value;
  const {start:startDate,end:endDate}=normalizeRangeValues(document.getElementById('uw-date-start').value,document.getElementById('uw-date-end').value);
  const rate=+gs().settings.rate||59.891;
  let usd=+document.getElementById('uw-usd').value||0;
  let php=+document.getElementById('uw-php').value||0;
  if(!usd&&php) usd=+(php/rate).toFixed(2);
  if(!php&&usd) php=+(usd*rate).toFixed(2);
  const item={id:id||uid(),date:startDate,startDate,endDate,client:document.getElementById('uw-client').value,hours:+document.getElementById('uw-hrs').value||null,usd,php,status:document.getElementById('uw-status').value||'paid'};
  if(!item.startDate||(!item.usd&&!item.php)){toast('Please add date and either USD or PHP amount','var(--red)');return;}
  const s=gs(); if(id){const i=s.upworkLogs.findIndex(l=>l.id===id);if(i>-1)s.upworkLogs[i]=item;}else s.upworkLogs.unshift(item);
  ss(s);closeM('m-uw');toast('Log saved');renderUpwork();
}
function delUpwork(id){askConfirm(()=>{const s=gs();s.upworkLogs=s.upworkLogs.filter(l=>l.id!==id);ss(s);toast('Removed','var(--amber)');renderUpwork();});}
function toggleUpworkStatus(id){
  const s=gs();
  const i=s.upworkLogs.findIndex(l=>l.id===id);
  if(i<0) return;
  s.upworkLogs[i].status=upworkStatus(s.upworkLogs[i])==='paid'?'pending':'paid';
  ss(s);
  toast(s.upworkLogs[i].status==='paid'?'Marked as paid':'Marked as pending');
  renderUpwork();
}

function renderUpwork(){
  const s=gs();
  const {start:startF,end:endF}=normalizeDateRange('uwf-start','uwf-end');
  const rangeLbl=(startF||endF)?`${startF||'Start'} to ${endF||'End'}`:'All time';
  const logs=[...(s.upworkLogs||[])].filter(l=>{
    const {start,end}=getEntryRange(l);
    return rangesOverlap(start,end,startF,endF);
  }).sort((a,b)=>getEntryRange(b).start.localeCompare(getEntryRange(a).start));
  const paidLogs=logs.filter(l=>upworkStatus(l)==='paid');
  const pendingLogs=logs.filter(l=>upworkStatus(l)==='pending');
  const paidPHP=paidLogs.reduce((a,l)=>a+(+l.php||0),0);
  const pendingPHP=pendingLogs.reduce((a,l)=>a+(+l.php||0),0);
  const paidUSD=paidLogs.reduce((a,l)=>a+(+l.usd||0),0);
  const pendingUSD=pendingLogs.reduce((a,l)=>a+(+l.usd||0),0);
  const totalPHP=paidPHP+pendingPHP;
  const totalUSD=paidUSD+pendingUSD;
  const tH=logs.reduce((a,l)=>a+(+l.hours||0),0);
  document.getElementById('uw-metrics').innerHTML=`
    <div class="mcard g"><div class="m-label">Paid (Received)</div><div class="m-value g">${P(paidPHP)}</div><div class="m-sub">$${paidUSD.toFixed(2)} · ${rangeLbl}</div></div>
    <div class="mcard a"><div class="m-label">Pending (Held)</div><div class="m-value a">${P(pendingPHP)}</div><div class="m-sub">$${pendingUSD.toFixed(2)} · waiting release</div></div>
    <div class="mcard b"><div class="m-label">Total (All)</div><div class="m-value b">${P(totalPHP)}</div><div class="m-sub">$${totalUSD.toFixed(2)} · paid + pending</div></div>
    <div class="mcard t"><div class="m-label">Total Hours</div><div class="m-value t">${(+tH).toFixed(1)}</div><div class="m-sub">Logged</div></div>`;
  killChart('ch-uw');
  const recent=logs.slice(0,20).reverse();
  const cv=document.getElementById('ch-uw');
  if(cv) CH['ch-uw']=new Chart(cv,{type:'bar',data:{labels:recent.map(l=>{const {start,end}=getEntryRange(l);return fmtRangeShort(start,end);}),datasets:[{data:recent.map(l=>+l.php||0),backgroundColor:recent.map(l=>upworkStatus(l)==='paid'?'rgba(61,139,95,.75)':'rgba(168,122,44,.78)'),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${upworkStatus(recent[c.dataIndex])==='paid'?'Paid':'Pending'} · ₱${c.parsed.y.toFixed(2)}`}}},scales:{y:{ticks:{callback:v=>'₱'+v}},x:{ticks:{autoSkip:false,maxRotation:45,font:{size:10}}}}}});
  document.getElementById('uw-body').innerHTML=!logs.length?`<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No Upwork logs for this date range</div></div>`:logs.map(l=>`
    <div class="tbl-row tbl-row-uw">
      <div class="tbl-cell tbl-cell-mono" data-label="Date" style="color:var(--muted)">${fmtRangeShort(getEntryRange(l).start,getEntryRange(l).end)}</div>
      <div class="tbl-cell tbl-cell-mono" data-label="Hours">${l.hours!=null?l.hours+'h':'-'}</div>
      <div class="tbl-cell tbl-cell-mono" data-label="USD" style="color:var(--green)">$${(+l.usd||0).toFixed(2)}</div>
      <div class="tbl-cell tbl-cell-mono" data-label="PHP" style="color:var(--blue)">${P(l.php)}</div>
      <div class="tbl-cell" data-label="Client" style="color:var(--muted)">${l.client||'-'}</div>
      <div class="tbl-cell" data-label="Status">${upworkStatus(l)==='paid'?'<span class="chip chip-g">Paid</span>':'<span class="chip chip-a">Pending</span>'}</div>
      <div class="tbl-cell tbl-actions" data-label="Actions" style="display:flex;gap:3px;justify-content:flex-end">
        <button class="icon-btn" onclick="toggleUpworkStatus('${l.id}')" title="Toggle paid/pending"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5h8M11 3l2 2-2 2M13 11H5M5 9l-2 2 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn edt" onclick="openUpworkModal('${l.id}')"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn dlt dng" onclick="delUpwork('${l.id}')"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>`).join('');
}

// ─── OVERVIEW ─────────────────────────────────────────
function renderOverview(){
  const s=gs(); const txs=s.transactions||[];
  const incomeTxs=txs.filter(t=>t.type==='income');
  const directExpenseTxs=txs.filter(t=>t.type==='expense'&&!t.budgetPayment);
  const paidBudgetTxs=[...paidBudgetAsExpenses(s),...budgetLoggedExpenseTxs(s)];
  const paidSubTxs=paidSubscriptionsAsExpenses(s);
  const paidLoanTxs=paidLoansAsExpenses(s);
  const allExpenseTxs=[...directExpenseTxs,...paidBudgetTxs,...paidSubTxs,...paidLoanTxs];
  const totI=incomeTxs.reduce((a,t)=>a+(+t.amount||0),0);
  const totE=allExpenseTxs.reduce((a,t)=>a+(+t.amount||0),0);
  const totD=s.loans.reduce((a,l)=>a+(+l.total||0),0);
  const debtBal=s.loans.reduce((a,l)=>a+(+l.balance||0),0);
  const curM=td().slice(0,7);
  const mI=incomeTxs.filter(t=>entryInMonth(t,curM)).reduce((a,t)=>a+(+t.amount||0),0);
  const mE=allExpenseTxs.filter(t=>entryInMonth(t,curM)).reduce((a,t)=>a+(+t.amount||0),0);
  const openLoans=s.loans.filter(l=>l.status!=='paid');
  const savings=currentSavings(s.settings);
  const savingsBase=lastMonthSavings(s.settings);
  const savingsDelta=savingsMonthDelta(s.settings);
  const savingsDeltaTone=savingsDeltaClass(savingsDelta);
  const breakdownRows=(entries,total,color,emptyTitle,emptyNote)=>entries.length
    ? entries.slice(0,3).map(([label,amt])=>`<div class="mini-row"><div><strong>${label}</strong><small>${Math.round(((+amt||0)/(total||1))*100)}% share</small></div><div style="font-family:'IBM Plex Mono',monospace;color:${color}">${P(amt)}</div></div>`).join('')
    : `<div class="mini-row"><div><strong>${emptyTitle}</strong><small>${emptyNote}</small></div><div style="font-family:'IBM Plex Mono',monospace;color:var(--muted)">—</div></div>`;
  const hrEl=document.getElementById('hero-greet'); if(hrEl){const h=new Date().getHours();hrEl.textContent=(h<12?'Good morning':h<18?'Good afternoon':'Good evening')+' · '+new Date().toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric'});}
  const hn=document.getElementById('hero-name'); if(hn) hn.textContent=s.settings.name||'Cheri';
  renderOverviewDueAlerts(s);
  document.getElementById('ov-metrics').innerHTML=`
    <div class="mcard g"><div class="m-label">Total Income</div><div class="m-value g">${P(totI)}</div><div class="m-sub">This month: ${P(mI)}</div></div>
    <div class="mcard r"><div class="m-label">Total Expenses</div><div class="m-value r">${P(totE)}</div><div class="m-sub">This month: ${P(mE)}</div></div>
    <div class="mcard a"><div class="m-label">Debt Balance</div><div class="m-value a">${P(debtBal)}</div><div class="m-sub">Original debt: ${P(totD)}</div></div>
    <div class="mcard b balance-card">
      <div class="m-label">Starting Balance</div>
      <div class="m-value b">${P(savings)}</div>
      <div class="m-sub savings-change ${savingsDeltaTone}">Last month ${P(savingsBase)} · ${savingsDeltaLabel(savingsDelta).replace(' this month','')}: ${savingsDeltaText(savingsDelta)}</div>
    </div>`;
  const iBC={}; incomeTxs.forEach(t=>{iBC[t.cat]=(iBC[t.cat]||0)+(+t.amount||0);});
  const iE=Object.entries(iBC).sort((a,b)=>b[1]-a[1]);
  killChart('ch-inc-d');
  const id_cv=document.getElementById('ch-inc-d');
  if(id_cv&&iE.length) CH['ch-inc-d']=new Chart(id_cv,{type:'doughnut',data:{labels:iE.map(e=>e[0]),datasets:[{data:iE.map(e=>e[1]),backgroundColor:CLR,borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'₱'+Math.round(c.parsed).toLocaleString()}}}}});
  const eBC={}; allExpenseTxs.forEach(t=>{eBC[t.cat]=(eBC[t.cat]||0)+(+t.amount||0);});
  const eE=Object.entries(eBC).sort((a,b)=>b[1]-a[1]).slice(0,8);
  killChart('ch-exp-d');
  const ed_cv=document.getElementById('ch-exp-d');
  if(ed_cv&&eE.length) CH['ch-exp-d']=new Chart(ed_cv,{type:'doughnut',data:{labels:eE.map(e=>e[0]),datasets:[{data:eE.map(e=>e[1]),backgroundColor:CLR,borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'₱'+Math.round(c.parsed).toLocaleString()}}}}});
  const incBreakdown=document.getElementById('inc-breakdown');
  if(incBreakdown) incBreakdown.innerHTML=breakdownRows(iE,totI,'var(--green)','No income sources yet','Log income to build this view.');
  const expBreakdown=document.getElementById('exp-breakdown');
  if(expBreakdown) expBreakdown.innerHTML=breakdownRows(eE,totE,'var(--red)','No expenses yet','Paid bills and expense entries will appear here.');
  const mMap={};
  incomeTxs.forEach(t=>{const m=getEntryRange(t).start.slice(0,7);if(!m)return;if(!mMap[m])mMap[m]={i:0,e:0};mMap[m].i+=+t.amount||0;});
  allExpenseTxs.forEach(t=>{const m=getEntryRange(t).start.slice(0,7);if(!m)return;if(!mMap[m])mMap[m]={i:0,e:0};mMap[m].e+=+t.amount||0;});
  const months=Object.keys(mMap).sort().slice(-12);
  killChart('ch-cf');
  const cf_cv=document.getElementById('ch-cf');
  if(cf_cv) CH['ch-cf']=new Chart(cf_cv,{type:'bar',data:{labels:months,datasets:[{label:'Income',data:months.map(m=>mMap[m].i),backgroundColor:'rgba(61,139,95,.55)',borderRadius:3},{label:'Expenses',data:months.map(m=>mMap[m].e),backgroundColor:'rgba(181,74,94,.5)',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:'#8a8a96',boxWidth:10,font:{size:11}}}},scales:{y:{ticks:{callback:v=>'₱'+(v/1000).toFixed(0)+'k'}}}}});
  document.getElementById('ov-top-exp').innerHTML=eE.length
    ? eE.slice(0,5).map(([cat,amt])=>`<div class="sum-row"><span>${cat}</span><span style="font-family:'IBM Plex Mono',monospace;color:var(--red)">${P(amt)}</span></div>`).join('')
    : `<div class="mini-row"><div><strong>No expenses tracked</strong><small>Add expenses or mark bills paid to populate this list.</small></div><div style="font-family:'IBM Plex Mono',monospace;color:var(--muted)">—</div></div>`;
  document.getElementById('ov-loans').innerHTML=openLoans.length
    ? openLoans.slice(0,5).map(l=>`<div class="sum-row"><span>${l.name}</span><div style="text-align:right"><div style="font-family:'IBM Plex Mono',monospace;color:var(--amber)">${P(l.balance)}</div>${l.monthly?`<div style="font-size:11px;color:var(--muted)">${P(l.monthly)}/mo</div>`:''}</div></div>`).join('')
    : `<div class="mini-row"><div><strong>No open loans</strong><small>Your balances are clear right now.</small></div><div style="font-family:'IBM Plex Mono',monospace;color:var(--muted)">—</div></div>`;
}

// ─── SETTINGS ─────────────────────────────────────────
function renderSettings(){
  const s=gs();
  document.getElementById('s-name').value=s.settings.name||'';
  document.getElementById('s-rate').value=s.settings.rate||59.891;
  const balInput=document.getElementById('s-bal');
  if(balInput) balInput.value=currentSavings(s.settings);
  const previousInput=document.getElementById('s-save-prev');
  if(previousInput) previousInput.value=lastMonthSavings(s.settings);
  document.getElementById('s-save').value=s.settings.savings||0;
  const alertNote=document.getElementById('s-alert-note');
  if(alertNote){
    const leadDays=dueAlertLeadDays(s.settings);
    const dueAlerts=collectDueAlerts(s);
    const summary=summarizeDueAlerts(dueAlerts);
    alertNote.innerHTML=dueAlerts.length
      ? `<strong>${summary.overdue}</strong> overdue · <strong>${summary.today}</strong> due today · <strong>${summary.soon+summary.upcoming}</strong> within ${leadDays} days. The same ping shows in the top bar and on Overview.`
      : `You're all caught up. When a loan or subscription comes within ${leadDays} days, the app will flag it in the top bar and on Overview. Use your phone reminders for push alerts outside the app.`;
  }
  const savingsNote=document.getElementById('s-save-note');
  if(savingsNote){
    const delta=savingsMonthDelta(s.settings);
    savingsNote.innerHTML=`Last month: <strong>${P(lastMonthSavings(s.settings))}</strong> · ${savingsDeltaLabel(delta)}: <strong class="save-delta ${savingsDeltaClass(delta)}">${savingsDeltaText(delta)}</strong>`;
  }
  document.getElementById('sf-name').textContent=s.settings.name||'Cheri';
  renderCats();
}
function saveSettings(){
  const s=gs();
  applySettingsFromForm(s);
  ss(s); document.getElementById('sf-name').textContent=s.settings.name; renderSettings(); toast('Settings saved');
}
function renderCats(){
  const s=gs();
  const all=[...s.categories.expense.map(c=>({c,t:'expense'})),...s.categories.income.map(c=>({c,t:'income'}))];
  document.getElementById('cat-body').innerHTML=all.map(({c,t})=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
      <div style="display:flex;align-items:center;gap:8px"><span class="chip ${t==='income'?'chip-g':'chip-r'}" style="font-size:10px;padding:2px 6px">${t}</span><span>${c}</span></div>
      <button class="icon-btn dng" onclick="delCat('${c}','${t}')"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`).join('');
}
function addCat(){
  const name=document.getElementById('new-cat').value.trim().toUpperCase();
  const type=document.getElementById('new-cat-type').value;
  if(!name)return;
  const s=gs(); if(!s.categories[type].includes(name)) s.categories[type].push(name);
  ss(s); document.getElementById('new-cat').value=''; renderCats(); toast('Category added');
}
function delCat(name,type){
  const s=gs(); s.categories[type]=s.categories[type].filter(c=>c!==name); ss(s); renderCats(); toast('Category removed','var(--amber)');
}
function exportData(){
  const blob=new Blob([JSON.stringify(gs(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Cheri_finance_'+td()+'.json'; a.click(); toast('Exported!');
}
function importData(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    const r=new FileReader(); r.onload=ev=>{try{ss(JSON.parse(ev.target.result));toast('Data imported!');renderP(curPanel());}catch{toast('Invalid file','var(--red)');}};
    r.readAsText(f);
  }; inp.click();
}
function clearAll(){
  askConfirm(()=>{ss(seed());toast('All cloud data cleared','var(--amber)');renderP(curPanel());},'Clear all');
}

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const now=new Date();
  document.getElementById('todayBadge').textContent=now.toLocaleDateString('en-PH',{month:'short',day:'numeric'});
  cloudToken=sessionStorage.getItem(CLOUD_TOKEN_KEY)||'';
  cloudApiUrl=sessionStorage.getItem(CLOUD_API_KEY)||DEFAULT_CLOUD_API_URL;
  if(!cloudToken){
    showUnlock();
    return;
  }
  loadCloudData();
});

function finishAppInit(){
  if(appInitialized){
    renderP(curPanel());
    return;
  }
  appInitialized=true;
  const s=gs();
  document.getElementById('sf-name').textContent=s.settings.name||'Cheri';
  refreshTxCats();
  nav({dataset:{panel:getInitialPanel()}});
  setTimeout(maybeToastDuePing,160);
  syncResponsiveShell();
  window.addEventListener('resize',syncResponsiveShell);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeSidebar(); });
}
