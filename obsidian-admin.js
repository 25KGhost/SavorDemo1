/**
 * obsidian-admin.js
 * Full admin controller — OBSIDIAN restaurant starter plan.
 * Features: whitelisted admin creation, reservations (current/upcoming),
 * hero image management, EmailJS notifications, menu CRUD, backup exports.
 */

import {
  adminLogin, adminRegister, adminLogout,
  adminFetchReservations, adminUpdateReservationStatus,
  adminUpdateReservationTime, adminMarkArrival,
  adminFetchMenuItems, adminUpdateMenu, adminDeleteMenuItem,
  adminFetchHeroImages, adminSaveHeroImages,
  getConfig,
} from './obsidian-api.js';

// ─── WHITELISTED GMAIL ACCOUNTS ───────────────────────────────
// Change these to the 4 real admin email addresses
const ALLOWED_EMAILS = [
  'admin1@gmail.com',
  'admin2@gmail.com',
  'admin3@gmail.com',
  'admin4@gmail.com',
];

// ─── EMAILJS CONFIG ───────────────────────────────────────────
// These are set in Vercel env vars; we fetch them from /api/config
let EMAILJS_SERVICE_ID  = '';
let EMAILJS_TEMPLATE_CONFIRM = 'template_confirm';
let EMAILJS_TEMPLATE_CANCEL  = 'template_cancel';
let EMAILJS_TEMPLATE_NOSHOW  = 'template_noshow';
let EMAILJS_PUBLIC_KEY  = '';
let emailjsLoaded = false;

async function initEmailJS() {
  if (emailjsLoaded) return;
  try {
    const cfg = await getConfig();
    EMAILJS_SERVICE_ID = cfg.emailjsServiceId || '';
    EMAILJS_PUBLIC_KEY = cfg.emailjsPublicKey || '';
    EMAILJS_TEMPLATE_CONFIRM = cfg.emailjsTemplateConfirm || 'template_confirm';
    EMAILJS_TEMPLATE_CANCEL  = cfg.emailjsTemplateCancel  || 'template_cancel';
    EMAILJS_TEMPLATE_NOSHOW  = cfg.emailjsTemplateNoShow  || 'template_noshow';
    if (EMAILJS_PUBLIC_KEY && !document.getElementById('ejs-sdk')) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.id = 'ejs-sdk'; s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      emailjsLoaded = true;
    }
  } catch (err) {
    console.warn('[EmailJS] init failed:', err.message);
  }
}

async function sendEmail(templateId, params) {
  if (!emailjsLoaded || !EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY) {
    console.log('[EmailJS] skipped (not configured):', params);
    return;
  }
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, templateId, params);
  } catch (err) {
    console.warn('[EmailJS] send failed:', err);
  }
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date(d + 'T12:00:00')); }
  catch { return d; }
}
function fmtTime(t) {
  if (!t) return '—';
  try { const [h,m]=t.split(':').map(Number); const d=new Date(); d.setHours(h,m); return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
  catch { return t; }
}

async function notifyConfirmed(r) {
  await sendEmail(EMAILJS_TEMPLATE_CONFIRM, {
    to_email: r.email, to_name: r.name,
    res_id:   String(r.id||'').slice(-8).toUpperCase(),
    res_date: fmtDate(r.date), res_time: fmtTime(r.time),
    res_guests: r.guests,
    restaurant_name: 'Obsidian',
  });
}

async function notifyCancelled(r, reason) {
  await sendEmail(EMAILJS_TEMPLATE_CANCEL, {
    to_email: r.email, to_name: r.name,
    res_date: fmtDate(r.date), res_time: fmtTime(r.time),
    cancel_reason: reason || 'No reason provided.',
    restaurant_name: 'Obsidian',
  });
}

async function notifyNoShow(r) {
  await sendEmail(EMAILJS_TEMPLATE_NOSHOW, {
    to_email: r.email, to_name: r.name,
    res_date: fmtDate(r.date), res_time: fmtTime(r.time),
    restaurant_name: 'Obsidian',
  });
}

// ─── UTILS ────────────────────────────────────────────────────
function esc(s) { if (typeof s!=='string') return ''; return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[c])); }
function fmtDT(iso) { if (!iso) return '—'; try { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); } catch { return iso; } }
function statusBadge(s) {
  const m={confirmed:'b-confirmed',pending:'b-pending',arrived:'b-arrived',cancelled:'b-cancelled',no_show:'b-no_show'};
  return `<span class="badge ${m[s]||''}">${esc(s||'unknown')}</span>`;
}
function toast(msg, ok=true) {
  const el=document.createElement('div');
  el.style.cssText=`position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;background:${ok?'rgba(129,199,132,.12)':'rgba(229,57,53,.12)'};border:1px solid ${ok?'rgba(129,199,132,.3)':'rgba(239,154,154,.3)'};color:${ok?'#81c784':'#ef9a9a'};font-family:'DM Sans',sans-serif;font-size:.82rem;padding:.9rem 1.4rem;border-radius:10px;animation:toastIn .3s ease;z-index:9999;max-width:320px;`;
  el.textContent=msg;
  if (!document.getElementById('toast-styles')) {
    const s=document.createElement('style');s.id='toast-styles';
    s.textContent='@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }
  document.body.appendChild(el);setTimeout(()=>el.remove(),3500);
}

// ─── CURRENT / UPCOMING DETECTION ─────────────────────────────
// A reservation is "current" if today's date matches the reservation date
// and current time is within ±30 min of the reservation time.
// A reservation is "upcoming" if the date is in the future (not today),
// OR if today but the time hasn't come yet.
function getReservationStatus(r) {
  if (!r.date || !r.time) return null;
  const now = new Date();
  const [rh, rm] = r.time.split(':').map(Number);
  const resDateTime = new Date(r.date + 'T' + r.time + ':00');
  const todayStr = now.toISOString().slice(0,10);
  const isToday = r.date === todayStr;
  const isPast = resDateTime < now;

  if (!isPast && isToday) {
    // check if within 30 min before to 90 min after
    const diffMs = resDateTime - now;
    if (diffMs >= -90*60*1000 && diffMs <= 30*60*1000) return 'current';
    return 'upcoming';
  }
  if (!isPast && !isToday) return 'upcoming';
  return null; // past
}

// ─── SESSION TIMER ─────────────────────────────────────────────
let sessionStart = Date.now(), sessInt = null;
function startSession() {
  clearInterval(sessInt); sessionStart = Date.now();
  sessInt = setInterval(() => {
    const e = Math.floor((Date.now()-sessionStart)/1000);
    const lbl = document.getElementById('sess-lbl');
    if (lbl) lbl.textContent = `${Math.floor(e/60)}m ${String(e%60).padStart(2,'0')}s`;
  }, 1000);
}

// ─── TAB SWITCHING (login/register) ───────────────────────────
window.showTab = function(tab) {
  document.getElementById('login-tab').style.display = tab==='login' ? 'block' : 'none';
  document.getElementById('register-tab').style.display = tab==='register' ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='register')));
};

// ─── LOGIN ─────────────────────────────────────────────────────
window.doLogin = async function() {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  const errEl = document.getElementById('l-err');
  const btn   = document.getElementById('l-btn');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Please fill in all fields.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  const result = await adminLogin(email, pass);
  if (result.ok) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    startSession();
    await initEmailJS();
    loadReservations();
  } else {
    errEl.textContent = result.message || 'Login failed. Check your credentials.';
    btn.disabled = false; btn.textContent = 'Sign In';
  }
};

// ─── REGISTER ──────────────────────────────────────────────────
window.doRegister = async function() {
  const email = document.getElementById('r-email').value.trim().toLowerCase();
  const pass  = document.getElementById('r-pass').value;
  const pass2 = document.getElementById('r-pass2').value;
  const errEl = document.getElementById('r-err');
  const btn   = document.getElementById('r-btn');
  errEl.textContent = '';

  if (!ALLOWED_EMAILS.map(e=>e.toLowerCase()).includes(email)) {
    errEl.textContent = 'This email is not on the authorized list.'; return;
  }
  if (pass.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (pass !== pass2)  { errEl.textContent = 'Passwords do not match.'; return; }

  btn.disabled = true; btn.textContent = 'Creating…';
  const result = await adminRegister(email, pass);
  if (result.ok) {
    document.getElementById('r-ok').style.display = 'block';
    document.getElementById('r-email').value = '';
    document.getElementById('r-pass').value  = '';
    document.getElementById('r-pass2').value = '';
  } else {
    errEl.textContent = result.message || 'Registration failed.';
  }
  btn.disabled = false; btn.textContent = 'Create Account';
};

// ENTER key on login
document.getElementById('l-pass')?.addEventListener('keydown', e => { if (e.key==='Enter') window.doLogin(); });
document.getElementById('l-email')?.addEventListener('keydown', e => { if (e.key==='Enter') window.doLogin(); });

// ─── LOGOUT ────────────────────────────────────────────────────
document.getElementById('logout-btn')?.addEventListener('click', () => {
  adminLogout(); clearInterval(sessInt);
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('l-email').value = '';
  document.getElementById('l-pass').value  = '';
  document.getElementById('l-err').textContent = '';
  document.getElementById('l-btn').textContent = 'Sign In';
  document.getElementById('l-btn').disabled = false;
  currentReservations = [];
});

// ─── SIDEBAR NAV ───────────────────────────────────────────────
const secMeta = {
  reservations: ['Reservations', 'View, filter and manage all bookings'],
  analytics:    ['Analytics',    'Booking trends and insights'],
  menu:         ['Menu Manager', 'Add, edit and toggle menu items'],
  hero:         ['Hero Images',  'Manage homepage dish images'],
  backup:       ['Backup & Export', 'Download and safeguard your data'],
};
document.querySelectorAll('.sb-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.sb-link').forEach(l=>l.classList.remove('active'));
    document.querySelectorAll('.admin-sec').forEach(s=>s.classList.remove('active'));
    link.classList.add('active');
    const sec = link.dataset.sec;
    document.getElementById(`sec-${sec}`)?.classList.add('active');
    const [t,s] = secMeta[sec]||['',''];
    document.getElementById('sec-title').textContent = t;
    document.getElementById('sec-sub').textContent   = s;
    if (sec==='reservations') loadReservations();
    if (sec==='analytics')    loadAnalytics();
    if (sec==='menu')         loadMenuItems();
    if (sec==='hero')         loadHeroImages();
  });
});

// ─── RESERVATIONS ──────────────────────────────────────────────
let currentReservations = [], currentFilter = 'all';

document.querySelectorAll('#sec-reservations .fbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#sec-reservations .fbtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); currentFilter = btn.dataset.filter;
    renderReservations();
  });
});

async function loadReservations() {
  document.getElementById('res-wrap').innerHTML = '<p class="loading">Loading reservations…</p>';
  try {
    currentReservations = await adminFetchReservations() || [];
    renderReservations();
  } catch (err) {
    document.getElementById('res-wrap').innerHTML = `<p class="loading" style="color:#ef9a9a">Error: ${esc(err.message)}</p>`;
  }
}

function renderReservations() {
  const wrap = document.getElementById('res-wrap');
  let rows = currentReservations;

  if (currentFilter === 'current') {
    rows = rows.filter(r => getReservationStatus(r) === 'current' && !['cancelled','no_show'].includes(r.status));
  } else if (currentFilter === 'upcoming') {
    rows = rows.filter(r => getReservationStatus(r) === 'upcoming' && !['cancelled','no_show'].includes(r.status));
  } else if (currentFilter !== 'all') {
    rows = rows.filter(r => r.status === currentFilter);
  }

  if (!rows.length) { wrap.innerHTML = '<p class="loading">No reservations found.</p>'; return; }

  wrap.innerHTML = `<table class="tbl">
    <thead><tr>
      <th>Guest</th><th>Date & Time</th><th>Guests</th><th>Timing</th><th>Status</th><th>Booked</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows.map(r => {
      const timing = getReservationStatus(r);
      const timingBadge = timing==='current'
        ? '<span class="badge b-current">● Now</span>'
        : timing==='upcoming'
        ? '<span class="badge b-upcoming">Soon</span>'
        : '—';
      return `<tr>
        <td>
          <div style="font-size:.88rem;color:#f0ece4;font-weight:500">${esc(r.name)}</div>
          <div style="font-size:.72rem;color:#5c5a56;margin-top:.15rem">${esc(r.email)}</div>
          <div style="font-size:.72rem;color:#5c5a56">${esc(r.phone||'')}</div>
        </td>
        <td><div style="color:#f0ece4">${fmtDate(r.date).replace(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /,'')}</div><div style="font-size:.75rem;color:#5c5a56">${fmtTime(r.time)}</div></td>
        <td style="color:#c9a96e;font-family:'Cormorant Garamond',serif;font-size:1.1rem">${r.guests}</td>
        <td>${timingBadge}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:.72rem">${fmtDT(r.created_at)}</td>
        <td>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            ${r.status!=='arrived'&&r.status!=='cancelled'&&r.status!=='no_show'?`<button class="abt ok" onclick="markArrived('${r.id}')">✓ Arrived</button>`:''}
            ${r.status!=='cancelled'&&r.status!=='no_show'?`<button class="abt" onclick="openTimeModal('${r.id}')">⟳ Reschedule</button>`:''}
            ${r.status!=='cancelled'&&r.status!=='no_show'?`<button class="abt danger" onclick="openCancelModal('${r.id}')">✕ Cancel</button>`:''}
            ${r.status==='confirmed'||r.status==='arrived'?`<button class="abt danger" onclick="markNoShow('${r.id}')">No-show</button>`:''}
          </div>
          ${r.notes?`<div style="font-size:.72rem;color:#5c5a56;margin-top:.35rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes)}">${esc(r.notes)}</div>`:''}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ACTIONS
window.markArrived = async function(id) {
  try { await adminMarkArrival(id,true); toast('Guest marked as arrived.'); loadReservations(); }
  catch(err) { toast(err.message,false); }
};
window.markNoShow = async function(id) {
  if (!confirm('Mark this guest as no-show? They will receive an email.')) return;
  try {
    await adminUpdateReservationStatus(id,'no_show');
    const r = currentReservations.find(x=>x.id===id);
    if (r) notifyNoShow(r).catch(()=>{});
    toast('Marked as no-show.'); loadReservations();
  } catch(err) { toast(err.message,false); }
};

// CANCEL MODAL
let pendingCancelId = null;
window.openCancelModal = function(id) {
  pendingCancelId=id;
  document.getElementById('cancel-reason').value='';
  document.getElementById('cancel-err').textContent='';
  document.getElementById('cancel-modal').classList.add('open');
};
document.getElementById('cancel-dismiss')?.addEventListener('click',()=>document.getElementById('cancel-modal').classList.remove('open'));
document.getElementById('cancel-confirm')?.addEventListener('click',async()=>{
  const reason=document.getElementById('cancel-reason').value.trim();
  if(!reason){document.getElementById('cancel-err').textContent='Please provide a reason.';return}
  try {
    await adminUpdateReservationStatus(pendingCancelId,'cancelled',reason);
    const r=currentReservations.find(x=>x.id===pendingCancelId);
    if(r) notifyCancelled(r,reason).catch(()=>{});
    document.getElementById('cancel-modal').classList.remove('open');
    toast('Reservation cancelled. Guest notified.'); loadReservations();
  } catch(err){document.getElementById('cancel-err').textContent=err.message}
});

// TIME MODAL
let pendingTimeId = null;
window.openTimeModal = function(id) {
  pendingTimeId=id;
  const r=currentReservations.find(x=>x.id===id);
  if(r){document.getElementById('new-date').value=r.date||'';document.getElementById('new-time').value=r.time||'19:30';}
  document.getElementById('time-err').textContent='';
  document.getElementById('time-modal').classList.add('open');
};
document.getElementById('time-dismiss')?.addEventListener('click',()=>document.getElementById('time-modal').classList.remove('open'));
document.getElementById('time-confirm')?.addEventListener('click',async()=>{
  const nd=document.getElementById('new-date').value;
  const nt=document.getElementById('new-time').value;
  const reason=document.getElementById('time-reason').value.trim();
  if(!nd){document.getElementById('time-err').textContent='Please select a date.';return}
  try {
    await adminUpdateReservationTime(pendingTimeId,nd,nt);
    document.getElementById('time-modal').classList.remove('open');
    toast('Reservation rescheduled.'); loadReservations();
  } catch(err){document.getElementById('time-err').textContent=err.message}
});

// ─── ANALYTICS ─────────────────────────────────────────────────
async function loadAnalytics() {
  const wrap=document.getElementById('analytics-wrap');
  wrap.innerHTML='<p class="loading">Loading analytics…</p>';
  try {
    const all = await adminFetchReservations() || [];
    const now = new Date(); const todayStr = now.toISOString().slice(0,10);
    const thisMonth = all.filter(r=>r.date&&r.date.startsWith(now.toISOString().slice(0,7)));
    const today = all.filter(r=>r.date===todayStr);
    const upcoming = all.filter(r=>r.date>todayStr&&!['cancelled','no_show'].includes(r.status));
    const current = all.filter(r=>getReservationStatus(r)==='current'&&!['cancelled','no_show'].includes(r.status));
    const sc={};all.forEach(r=>{sc[r.status]=(sc[r.status]||0)+1});
    const avgGuests = all.length ? Math.round(all.reduce((s,r)=>s+(r.guests||0),0)/all.length*10)/10 : 0;
    wrap.innerHTML=`
      <div class="stat-grid">
        <div class="stat"><div class="stat-v">${all.length}</div><div class="stat-l">Total Reservations</div></div>
        <div class="stat"><div class="stat-v">${thisMonth.length}</div><div class="stat-l">This Month</div></div>
        <div class="stat"><div class="stat-v" style="color:#81c784">${current.length}</div><div class="stat-l">Currently Dining</div></div>
        <div class="stat"><div class="stat-v" style="color:#64b5f6">${today.length}</div><div class="stat-l">Today Total</div></div>
        <div class="stat"><div class="stat-v">${upcoming.length}</div><div class="stat-l">Upcoming</div></div>
        <div class="stat"><div class="stat-v">${sc.confirmed||0}</div><div class="stat-l">Confirmed</div></div>
        <div class="stat"><div class="stat-v">${sc.arrived||0}</div><div class="stat-l">Arrived</div></div>
        <div class="stat"><div class="stat-v">${sc.cancelled||0}</div><div class="stat-l">Cancelled</div></div>
        <div class="stat"><div class="stat-v">${sc.no_show||0}</div><div class="stat-l">No-shows</div></div>
        <div class="stat"><div class="stat-v">${avgGuests}</div><div class="stat-l">Avg Guests/Booking</div></div>
      </div>
      <div class="fpanel" style="margin-top:1rem">
        <p style="font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin-bottom:1rem">Status Breakdown</p>
        ${Object.entries(sc).map(([s,n])=>`
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:.8rem">
            <div style="width:100px;font-size:.78rem;color:#9b9690;text-transform:capitalize">${esc(s.replace('_',' '))}</div>
            <div style="flex:1;height:5px;background:#1e1e22;border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${Math.round(n/Math.max(all.length,1)*100)}%;background:#c9a96e;border-radius:3px;transition:width .6s"></div>
            </div>
            <div style="width:28px;font-size:.78rem;color:#f0ece4;text-align:right">${n}</div>
          </div>`).join('')}
      </div>
      <div class="fpanel" style="margin-top:1rem">
        <p style="font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin-bottom:1rem">Today's Reservations</p>
        ${today.length?today.map(r=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:1px solid rgba(42,42,46,.3)">
            <div><span style="color:#f0ece4;font-size:.88rem">${esc(r.name)}</span><span style="color:#5c5a56;font-size:.75rem;margin-left:1rem">${fmtTime(r.time)} · ${r.guests} guest${r.guests>1?'s':''}</span></div>
            ${statusBadge(r.status)}
          </div>`).join(''):'<p style="color:#5c5a56;font-size:.82rem">No reservations today.</p>'}
      </div>`;
  } catch(err) {
    wrap.innerHTML=`<p class="loading" style="color:#ef9a9a">Error: ${esc(err.message)}</p>`;
  }
}

// ─── MENU MANAGER ──────────────────────────────────────────────
let menuItems = [];
async function loadMenuItems() {
  document.getElementById('menu-tbl-wrap').innerHTML='<p class="loading">Loading…</p>';
  try { menuItems=await adminFetchMenuItems()||[]; renderMenuTable(); }
  catch(err) { document.getElementById('menu-tbl-wrap').innerHTML=`<p class="loading" style="color:#ef9a9a">Error: ${esc(err.message)}</p>`; }
}
function renderMenuTable() {
  const wrap=document.getElementById('menu-tbl-wrap');
  if(!menuItems.length){wrap.innerHTML='<p class="loading">No menu items yet.</p>';return}
  wrap.innerHTML=`<table class="tbl">
    <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Available</th><th>Actions</th></tr></thead>
    <tbody>${menuItems.map(it=>`<tr>
      <td><div style="color:#f0ece4;font-size:.88rem">${esc(it.name)}</div><div style="font-size:.72rem;color:#5c5a56;margin-top:.1rem">${esc(it.description||'')}</div></td>
      <td style="text-transform:capitalize">${esc(it.category)}</td>
      <td style="color:#c9a96e;font-family:'Cormorant Garamond',serif;font-size:1.05rem">€${parseFloat(it.price||0).toFixed(0)}</td>
      <td><span class="badge ${it.available?'b-confirmed':'b-cancelled'}">${it.available?'Yes':'Hidden'}</span></td>
      <td><div style="display:flex;gap:.4rem">
        <button class="abt" onclick="editMenuItem('${it.id}')">Edit</button>
        <button class="abt danger" onclick="deleteMenuItem('${it.id}')">Delete</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table>`;
}
document.getElementById('add-item-btn')?.addEventListener('click',()=>{
  document.getElementById('mf-title').textContent='Add Menu Item';
  document.getElementById('mi-id').value='';
  document.getElementById('menu-form').reset();
  document.getElementById('menu-form-wrap').style.display='block';
  document.getElementById('menu-form-wrap').scrollIntoView({behavior:'smooth'});
});
document.getElementById('cancel-mf')?.addEventListener('click',()=>document.getElementById('menu-form-wrap').style.display='none');
window.editMenuItem=function(id){
  const it=menuItems.find(m=>m.id===id);if(!it)return;
  document.getElementById('mf-title').textContent='Edit Menu Item';
  document.getElementById('mi-id').value=it.id;
  document.getElementById('mi-name').value=it.name;
  document.getElementById('mi-cat').value=it.category;
  document.getElementById('mi-price').value=it.price;
  document.getElementById('mi-avail').value=String(it.available);
  document.getElementById('mi-desc').value=it.description||'';
  document.getElementById('mi-img').value=it.image_url||'';
  document.getElementById('menu-form-wrap').style.display='block';
  document.getElementById('menu-form-wrap').scrollIntoView({behavior:'smooth'});
};
window.deleteMenuItem=async function(id){
  if(!confirm('Delete this menu item?'))return;
  try{await adminDeleteMenuItem(id);toast('Item deleted.');loadMenuItems();}
  catch(err){toast(err.message,false);}
};
document.getElementById('menu-form')?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  const id=document.getElementById('mi-id').value;
  const payload={
    id:id||undefined,name:document.getElementById('mi-name').value,
    category:document.getElementById('mi-cat').value,price:document.getElementById('mi-price').value,
    available:document.getElementById('mi-avail').value==='true',
    description:document.getElementById('mi-desc').value,image_url:document.getElementById('mi-img').value,
  };
  try{await adminUpdateMenu(payload);toast(id?'Item updated.':'Item added.');document.getElementById('menu-form-wrap').style.display='none';loadMenuItems();}
  catch(err){toast(err.message,false);}
});

// ─── HERO IMAGES ───────────────────────────────────────────────
let heroImages = [];
async function loadHeroImages() {
  try { heroImages = await adminFetchHeroImages() || []; }
  catch { heroImages = []; }
  renderHeroImages();
}
function renderHeroImages() {
  const list=document.getElementById('hero-img-list');
  if(!heroImages.length){list.innerHTML='<p style="font-size:.82rem;color:#5c5a56">No hero images saved yet. Add your first image below.</p>';return}
  list.innerHTML=heroImages.map((img,i)=>`
    <div class="hero-img-row">
      <img class="hero-img-preview" src="${esc(img.url)}" alt="${esc(img.caption||'')}" onerror="this.style.display='none'">
      <div class="hero-img-url">${esc(img.url)}</div>
      ${img.caption?`<span style="font-size:.72rem;color:#5c5a56;white-space:nowrap">${esc(img.caption)}</span>`:''}
      <button class="abt danger" onclick="removeHeroImage(${i})">✕</button>
    </div>`).join('');
}
window.addHeroImage = async function() {
  const url=document.getElementById('hero-new-url').value.trim();
  const cap=document.getElementById('hero-new-cap').value.trim();
  const msg=document.getElementById('hero-msg');
  if(!url){msg.textContent='Please enter an image URL.';msg.style.color='#ef9a9a';return}
  heroImages.push({url,caption:cap});
  try{
    await adminSaveHeroImages(heroImages);
    document.getElementById('hero-new-url').value='';
    document.getElementById('hero-new-cap').value='';
    msg.textContent='Image added and saved.';msg.style.color='#81c784';
    renderHeroImages();
    setTimeout(()=>{msg.textContent=''},3000);
  }catch(err){msg.textContent=err.message;msg.style.color='#ef9a9a';}
};
window.removeHeroImage = async function(i) {
  heroImages.splice(i,1);
  const msg=document.getElementById('hero-msg');
  try{
    await adminSaveHeroImages(heroImages);
    msg.textContent='Image removed.';msg.style.color='#81c784';
    renderHeroImages();
    setTimeout(()=>{msg.textContent=''},3000);
  }catch(err){msg.textContent=err.message;msg.style.color='#ef9a9a';}
};

// ─── BACKUP ────────────────────────────────────────────────────
function dl(content,filename,type='application/json'){
  const b=new Blob([content],{type}),url=URL.createObjectURL(b);
  Object.assign(document.createElement('a'),{href:url,download:filename}).click();
  URL.revokeObjectURL(url);
}
document.getElementById('exp-csv')?.addEventListener('click',async()=>{
  try{
    const rows=await adminFetchReservations();
    const csv='id,name,email,phone,date,time,guests,status,notes,created_at\n'+
      (rows||[]).map(r=>[r.id,r.name,r.email,r.phone,r.date,r.time,r.guests,r.status,(r.notes||'').replace(/,/g,' '),r.created_at]
        .map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    dl(csv,`obsidian-res-${new Date().toISOString().slice(0,10)}.csv`,'text/csv');toast('CSV downloaded.');
  }catch(err){toast(err.message,false);}
});
document.getElementById('exp-json')?.addEventListener('click',async()=>{
  try{
    const rows=await adminFetchReservations();
    const c=(rows||[]).map(({id,name,email,phone,date,time,guests,status})=>({id,name,email,phone,date,time,guests,status}));
    dl(JSON.stringify(c),`obsidian-res-${new Date().toISOString().slice(0,10)}.json`);toast('JSON downloaded.');
  }catch(err){toast(err.message,false);}
});
document.getElementById('exp-menu')?.addEventListener('click',async()=>{
  try{
    const items=await adminFetchMenuItems();
    const c=(items||[]).map(({name,category,price,description,available})=>({name,category,price,description,available}));
    dl(JSON.stringify(c),`obsidian-menu-${new Date().toISOString().slice(0,10)}.json`);toast('Menu JSON downloaded.');
  }catch(err){toast(err.message,false);}
});
document.getElementById('exp-full')?.addEventListener('click',async()=>{
  try{
    const [rows,items]=await Promise.all([adminFetchReservations(),adminFetchMenuItems()]);
    const full={exported_at:new Date().toISOString(),
      reservations:(rows||[]).map(({id,name,email,phone,date,time,guests,status})=>({id,name,email,phone,date,time,guests,status})),
      menu:(items||[]).map(({name,category,price,description,available})=>({name,category,price,description,available}))};
    dl(JSON.stringify(full),`obsidian-backup-${new Date().toISOString().slice(0,10)}.json`);toast('Full backup downloaded.');
  }catch(err){toast(err.message,false);}
});
