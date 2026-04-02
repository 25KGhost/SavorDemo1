/**
 * obsidian-api.js
 * All Supabase & external API interactions for OBSIDIAN.
 * Config loaded from /api/config (Vercel serverless).
 */

// ─── CONFIG ───────────────────────────────────────────────────
let _cfg = null;
export async function getConfig() {
  if (_cfg) return _cfg;
  try {
    const r = await fetch('/api/config');
    _cfg = await r.json();
    return _cfg;
  } catch (err) {
    console.error('[api] config error:', err);
    _cfg = {};
    return _cfg;
  }
}

// ─── SUPABASE REST CLIENT ─────────────────────────────────────
const sb = {
  async _req(path, opts = {}) {
    const cfg = await getConfig();
    const tok = this._tok();
    const key = tok || cfg.supabaseAnonKey;
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      headers: {
        'apikey': cfg.supabaseAnonKey,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': opts.prefer || 'return=representation',
        ...opts.headers,
      },
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.error_description || `Supabase ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  },
  _tok() {
    try {
      const k = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
      return k ? JSON.parse(localStorage.getItem(k))?.access_token || null : null;
    } catch { return null; }
  },
  query(path, opts = {}) { return this._req(path, opts); },
  auth(path, opts = {}) {
    if (!this._tok()) throw new Error('Not authenticated');
    return this._req(path, opts);
  },
};

// ─── SANITIZE ─────────────────────────────────────────────────
function san(s, max = 255) {
  if (typeof s !== 'string') return '';
  return s.slice(0, max).replace(/[<>"'`]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;','`':'&#x60;'}[c]));
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

// ─── RATE LIMIT ───────────────────────────────────────────────
const RL = { _s: {}, check(k, max=3, ms=60000) {
  const now=Date.now();
  if(!this._s[k])this._s[k]=[];
  this._s[k]=this._s[k].filter(t=>now-t<ms);
  if(this._s[k].length>=max)return false;
  this._s[k].push(now);return true;
}};

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
export async function adminLogin(email, password) {
  if (!validEmail(email)) return { ok: false, message: 'Invalid email.' };
  try {
    const cfg = await getConfig();
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');
    const host = new URL(cfg.supabaseUrl).hostname.split('.')[0];
    localStorage.setItem(`sb-${host}-auth-token`, JSON.stringify(data));
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, message: err.message || 'Login failed.' };
  }
}

export async function adminRegister(email, password) {
  if (!validEmail(email)) return { ok: false, message: 'Invalid email.' };
  try {
    const cfg = await getConfig();
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'apikey': cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Registration failed');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export function adminLogout() {
  Object.keys(localStorage).filter(k => k.endsWith('-auth-token')).forEach(k => localStorage.removeItem(k));
}

// ─────────────────────────────────────────────────────────────
// RESERVATIONS
// ─────────────────────────────────────────────────────────────
export async function adminFetchReservations() {
  return sb.auth('reservations?order=date.asc,time.asc');
}

export async function adminUpdateReservationStatus(id, status, reason = '') {
  const body = { status };
  if (reason) body.cancel_reason = san(reason, 500);
  return sb.auth(`reservations?id=eq.${id}`, { method: 'PATCH', body, prefer: 'return=minimal' });
}

export async function adminUpdateReservationTime(id, newDate, newTime) {
  return sb.auth(`reservations?id=eq.${id}`, {
    method: 'PATCH',
    body: { date: newDate, time: san(newTime, 20), status: 'confirmed' },
    prefer: 'return=minimal',
  });
}

export async function adminMarkArrival(id, arrived) {
  return sb.auth(`reservations?id=eq.${id}`, {
    method: 'PATCH',
    body: { arrived_at: arrived ? new Date().toISOString() : null, status: arrived ? 'arrived' : 'confirmed' },
    prefer: 'return=minimal',
  });
}

// ─────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────
export async function adminFetchMenuItems() {
  return sb.auth('menu_items?order=category,name');
}

export async function adminUpdateMenu(item) {
  const payload = {
    category: san(item.category, 50),
    name: san(item.name, 100),
    description: san(item.description || '', 500),
    price: parseFloat(item.price),
    available: Boolean(item.available),
    image_url: san(item.image_url || '', 500),
  };
  if (item.id) {
    return sb.auth(`menu_items?id=eq.${item.id}`, { method: 'PATCH', body: payload, prefer: 'return=minimal' });
  }
  return sb.auth('menu_items', { method: 'POST', body: payload });
}

export async function adminDeleteMenuItem(id) {
  return sb.auth(`menu_items?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
}

// ─────────────────────────────────────────────────────────────
// HERO IMAGES (stored in a Supabase `site_settings` table)
// Row: { key: 'hero_images', value: JSON string }
// ─────────────────────────────────────────────────────────────
export async function adminFetchHeroImages() {
  try {
    const rows = await sb.auth('site_settings?key=eq.hero_images&select=value');
    if (rows && rows.length) {
      return JSON.parse(rows[0].value);
    }
    return [];
  } catch {
    return [];
  }
}

export async function adminSaveHeroImages(images) {
  const value = JSON.stringify(images);
  // Upsert: update if exists, insert if not
  try {
    const existing = await sb.auth('site_settings?key=eq.hero_images&select=id');
    if (existing && existing.length) {
      await sb.auth(`site_settings?key=eq.hero_images`, {
        method: 'PATCH', body: { value }, prefer: 'return=minimal',
      });
    } else {
      await sb.auth('site_settings', {
        method: 'POST', body: { key: 'hero_images', value },
      });
    }
  } catch (err) {
    throw new Error('Could not save hero images: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC: SUBMIT RESERVATION
// ─────────────────────────────────────────────────────────────
export async function submitReservation(data) {
  if (!RL.check('reservation', 2, 60000)) return { ok: false, message: 'Too many requests. Please wait.' };
  const { name, email, phone, date, time, guests, notes = '' } = data;
  if (!name||!email||!phone||!date||!time||!guests) return { ok: false, message: 'Please fill in all required fields.' };
  if (!validEmail(email)) return { ok: false, message: 'Please enter a valid email address.' };
  if (parseInt(guests)<1||parseInt(guests)>20) return { ok: false, message: 'Guest count must be between 1 and 20.' };
  const rd=new Date(date),today=new Date(); today.setHours(0,0,0,0);
  const maxDate=new Date(today); maxDate.setDate(maxDate.getDate()+60);
  if (rd<today) return { ok: false, message: 'Please select a future date.' };
  if (rd>maxDate) return { ok: false, message: 'Reservations can be made up to 60 days in advance.' };
  const payload={name:san(name,100),email:san(email,100),phone:san(phone,30),date,time:san(time,20),guests:parseInt(guests),notes:san(notes,500),status:'confirmed'};
  try {
    const r=await fetch('/api/reservation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(r.ok) return r.json();
    throw 0;
  } catch {
    try {
      const rows=await sb.query('reservations',{method:'POST',body:payload});
      return {ok:true,reservation:Array.isArray(rows)?rows[0]:rows,message:'Reservation confirmed!'};
    } catch(err) {
      return {ok:false,message:'Something went wrong. Please try again.'};
    }
  }
}

export async function loadMenu() {
  try {
    const items=await sb.query('menu_items?available=eq.true&order=category,name');
    const g={starters:[],mains:[],desserts:[],drinks:[]};
    (items||[]).forEach(it=>{const c=it.category?.toLowerCase();if(g[c])g[c].push(it)});
    return g;
  } catch { return null; }
}
