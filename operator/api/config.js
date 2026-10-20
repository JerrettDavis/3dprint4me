export default function handler(_req, res) {
  const authProvider=process.env.OPERATOR_AUTH_PROVIDER??'neon';
  if(!['neon','authentik'].includes(authProvider)) { res.status(503).json({error:'Sign-in is temporarily unavailable.'});return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    apiBase: process.env.OPERATOR_API_BASE ?? "https://3dprint4.me",
    authProvider,
    authBase: authProvider==='neon'?(process.env.NEON_AUTH_BASE_URL ?? null):null
  });
}
