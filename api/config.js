/**
 * /api/config.js — Vercel Serverless Function
 * Serves public-safe runtime config to the frontend.
 * All secrets live in Vercel Dashboard → Environment Variables.
 */
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const config = {
    supabaseUrl:             process.env.SUPABASE_URL             || '',
    supabaseAnonKey:         process.env.SUPABASE_ANON_KEY        || '',
    googleReviewUrl:         process.env.GOOGLE_REVIEW_URL        || '',
    // EmailJS (public keys only — safe to expose)
    emailjsServiceId:        process.env.EMAILJS_SERVICE_ID       || '',
    emailjsPublicKey:        process.env.EMAILJS_PUBLIC_KEY       || '',
    emailjsTemplateConfirm:  process.env.EMAILJS_TEMPLATE_CONFIRM || 'template_confirm',
    emailjsTemplateCancel:   process.env.EMAILJS_TEMPLATE_CANCEL  || 'template_cancel',
    emailjsTemplateNoShow:   process.env.EMAILJS_TEMPLATE_NOSHOW  || 'template_noshow',
  };

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(config);
}
