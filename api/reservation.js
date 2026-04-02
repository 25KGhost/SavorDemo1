/**
 * /api/reservation.js — Vercel Serverless Function
 * ─────────────────────────────────────────────────────────────
 * Handles reservation creation server-side.
 * - Uses service_role key (bypasses RLS)
 * - Auto-confirms reservations
 * - Returns full reservation record (for ticket display)
 * - Optional: sends confirmation email via Resend
 * ─────────────────────────────────────────────────────────────
 */

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function sanitize(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>"'`]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;' }[c])
  );
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(dateStr + 'T12:00:00'));
  } catch { return dateStr; }
}

function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(); d.setHours(h, m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return timeStr; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone, date, time, guests, notes, _gotcha } = req.body || {};

  // Honeypot
  if (_gotcha) return res.status(200).json({ ok: true });

  // Validation
  if (!name || !email || !phone || !date || !time || !guests)
    return res.status(400).json({ ok: false, message: 'Missing required fields.' });
  if (!validateEmail(email))
    return res.status(400).json({ ok: false, message: 'Invalid email address.' });
  const guestCount = parseInt(guests);
  if (isNaN(guestCount) || guestCount < 1 || guestCount > 20)
    return res.status(400).json({ ok: false, message: 'Invalid guest count.' });

  const reservationDate = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + 60);
  if (isNaN(reservationDate) || reservationDate < today)
    return res.status(400).json({ ok: false, message: 'Please select a future date.' });
  if (reservationDate > maxDate)
    return res.status(400).json({ ok: false, message: 'Reservations can only be made up to 60 days in advance.' });

  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/reservations`, {
      method: 'POST',
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        name:   sanitize(name,  100),
        email:  sanitize(email, 100),
        phone:  sanitize(phone, 30),
        date,
        time:   sanitize(time,  20),
        guests: guestCount,
        notes:  sanitize(notes || '', 500),
        status: 'confirmed',
      }),
    });

    if (!dbRes.ok) {
      const err = await dbRes.json().catch(() => ({}));
      throw new Error(err.message || 'Database error');
    }

    const rows        = await dbRes.json();
    const reservation = Array.isArray(rows) ? rows[0] : rows;

    // ─── Optional: Confirmation email ─────────────────────
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && reservation?.email) {
      const shortId = String(reservation.id || '').slice(-8).toUpperCase();
      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    process.env.FROM_EMAIL || 'reservations@aurelia.com',
          to:      [reservation.email],
          subject: 'Reservation Confirmed — Aurelia',
          html: `
            <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#f5f5f7;background:#09090b;padding:3rem 2rem;border-radius:12px">
              <p style="font-size:1.8rem;letter-spacing:0.3em;text-align:center;color:#D0C3AD;margin-bottom:2rem">AURELIA</p>
              <h2 style="font-size:1.4rem;font-weight:300;margin-bottom:1.5rem">Dear ${sanitize(name, 60)},</h2>
              <p style="color:#86868B;line-height:1.6;margin-bottom:1.5rem">Your reservation is confirmed. We look forward to welcoming you.</p>
              <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:1.5rem;margin-bottom:1.5rem">
                <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Reservation ID:</strong> ${shortId}</p>
                <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Date:</strong> ${formatDateDisplay(date)}</p>
                <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Time:</strong> ${formatTimeDisplay(time)}</p>
                <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Guests:</strong> ${guestCount}</p>
              </div>
              <p style="color:#86868B;font-size:0.9rem">Please present your Reservation ID on arrival to avoid any confusion.</p>
              <p style="color:#D0C3AD;margin-top:2rem">— The Aurelia Team</p>
            </div>`,
        }),
      }).catch(err => console.error('[email]', err));
    }

    return res.status(200).json({
      ok: true,
      reservation,
      message: 'Reservation confirmed!',
    });

  } catch (err) {
    console.error('[/api/reservation]', err);
    return res.status(500).json({ ok: false, message: 'Could not save reservation.' });
  }
}