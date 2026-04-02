/**
 * /api/notify.js — Vercel Serverless Function
 * ─────────────────────────────────────────────────────────────
 * Sends email notifications to guests when an admin updates
 * their reservation (cancel, time change, no-show, etc.).
 *
 * Uses Resend for email delivery. Set RESEND_API_KEY in Vercel
 * environment variables to enable.
 *
 * Method: POST /api/notify
 * Body: { reservation, updateType, reason }
 * ─────────────────────────────────────────────────────────────
 */

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

const updateTemplates = {
  cancelled: (r, reason) => ({
    subject: 'Your Aurelia Reservation Has Been Cancelled',
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#f5f5f7;background:#09090b;padding:3rem 2rem;border-radius:12px">
        <p style="font-size:1.8rem;letter-spacing:0.3em;text-align:center;color:#D0C3AD;margin-bottom:2rem">AURELIA</p>
        <h2 style="font-size:1.4rem;font-weight:300;margin-bottom:1.5rem">Dear ${sanitize(r.name, 60)},</h2>
        <p style="color:#86868B;line-height:1.6;margin-bottom:1.5rem">
          We regret to inform you that your reservation on <strong style="color:#f5f5f7">${formatDateDisplay(r.date)}</strong>
          at <strong style="color:#f5f5f7">${formatTimeDisplay(r.time)}</strong> has been cancelled.
        </p>
        ${reason ? `<p style="color:#86868B;line-height:1.6;margin-bottom:1.5rem"><strong style="color:#f5f5f7">Reason:</strong> ${sanitize(reason, 500)}</p>` : ''}
        <p style="color:#86868B;line-height:1.6">
          We sincerely apologize for any inconvenience. Please do not hesitate to contact us or make a new reservation.
        </p>
        <p style="color:#D0C3AD;margin-top:2rem">— The Aurelia Team</p>
      </div>`,
  }),

  time_changed: (r, reason) => ({
    subject: 'Your Aurelia Reservation Has Been Updated',
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#f5f5f7;background:#09090b;padding:3rem 2rem;border-radius:12px">
        <p style="font-size:1.8rem;letter-spacing:0.3em;text-align:center;color:#D0C3AD;margin-bottom:2rem">AURELIA</p>
        <h2 style="font-size:1.4rem;font-weight:300;margin-bottom:1.5rem">Dear ${sanitize(r.name, 60)},</h2>
        <p style="color:#86868B;line-height:1.6;margin-bottom:1.5rem">
          Your reservation has been rescheduled to:
        </p>
        <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:1.5rem;margin-bottom:1.5rem">
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Date:</strong> ${formatDateDisplay(r.date)}</p>
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Time:</strong> ${formatTimeDisplay(r.time)}</p>
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Guests:</strong> ${r.guests}</p>
        </div>
        ${reason ? `<p style="color:#86868B;line-height:1.6;margin-bottom:1.5rem"><strong style="color:#f5f5f7">Note:</strong> ${sanitize(reason, 300)}</p>` : ''}
        <p style="color:#D0C3AD;margin-top:2rem">— The Aurelia Team</p>
      </div>`,
  }),

  confirmed: (r) => ({
    subject: 'Reservation Confirmed — Aurelia',
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#f5f5f7;background:#09090b;padding:3rem 2rem;border-radius:12px">
        <p style="font-size:1.8rem;letter-spacing:0.3em;text-align:center;color:#D0C3AD;margin-bottom:2rem">AURELIA</p>
        <h2 style="font-size:1.4rem;font-weight:300;margin-bottom:1.5rem">Dear ${sanitize(r.name, 60)},</h2>
        <p style="color:#86868B;line-height:1.6;margin-bottom:1.5rem">Your reservation is confirmed. We look forward to welcoming you.</p>
        <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:1.5rem;margin-bottom:1.5rem">
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Date:</strong> ${formatDateDisplay(r.date)}</p>
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Time:</strong> ${formatTimeDisplay(r.time)}</p>
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Guests:</strong> ${r.guests}</p>
          <p style="margin:0.4rem 0"><strong style="color:#D0C3AD">Reservation ID:</strong> ${String(r.id || '').slice(-8).toUpperCase()}</p>
        </div>
        <p style="color:#D0C3AD;margin-top:2rem">— The Aurelia Team</p>
      </div>`,
  }),
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reservation, updateType, reason } = req.body || {};
  if (!reservation || !updateType)
    return res.status(400).json({ ok: false, message: 'Missing reservation or updateType.' });

  const template = updateTemplates[updateType];
  if (!template)
    return res.status(400).json({ ok: false, message: `Unknown updateType: ${updateType}` });

  const { subject, html } = template(reservation, reason || '');

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // Email not configured — log and silently succeed so UI isn't blocked
    console.log(`[/api/notify] No RESEND_API_KEY. Would send to ${reservation.email}: ${subject}`);
    return res.status(200).json({ ok: true, message: 'Email skipped (no key configured).' });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    process.env.FROM_EMAIL || 'reservations@aurelia.com',
        to:      [reservation.email],
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      throw new Error(err.message || `Resend error ${emailRes.status}`);
    }

    return res.status(200).json({ ok: true, message: 'Email sent.' });
  } catch (err) {
    console.error('[/api/notify]', err);
    // Don't block the admin action if email fails
    return res.status(200).json({ ok: false, message: err.message });
  }
}