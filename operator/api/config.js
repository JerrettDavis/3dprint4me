export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    apiBase: process.env.OPERATOR_API_BASE ?? "https://3dprint4.me",
    authBase: process.env.NEON_AUTH_BASE_URL ?? null
  });
}
