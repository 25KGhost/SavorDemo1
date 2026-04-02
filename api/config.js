/**
 * /api/config.js  — Vercel Serverless Function
 * ─────────────────────────────────────────────────────────────
 * Serves public-safe config to the frontend at runtime.
 * Environment variables are set in the Vercel dashboard —
 * they are NEVER exposed in the source code or git repo.
 *
 * Called by: frontend pages on load → window.__ENV
 * Method:    GET /api/config
 * ─────────────────────────────────────────────────────────────
 */

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // These variables are set in Vercel Dashboard → Settings → Environment Variables
  // They are read at runtime on Vercel's server — never in the browser source
  const config = {
    supabaseUrl:           process.env.SUPABASE_URL            || '',
    supabaseAnonKey:       process.env.SUPABASE_ANON_KEY       || '',
    cloudinaryCloudName:   process.env.CLOUDINARY_CLOUD_NAME   || '',
    cloudinaryUploadPreset:process.env.CLOUDINARY_UPLOAD_PRESET|| '',
    googleReviewUrl:       process.env.GOOGLE_REVIEW_URL       || '',
  };

  // Validate that all required keys are present
  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    console.error('[/api/config] Missing env vars:', missing);
    // Still return — frontend will degrade gracefully
  }

  // Cache for 5 minutes (300s), revalidate in background
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.setHeader('Content-Type', 'application/json');

  return res.status(200).json(config);
}