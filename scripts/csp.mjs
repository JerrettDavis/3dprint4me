// Single source of truth for the Content-Security-Policy strings in vercel.json.
// tests/unit/customize-build.test.mjs asserts these equal the vercel.json values.
export const GLOBAL_CSP = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'sha256-sr6+xICxiVC0kIkhYHH6w1wxMXikqOJO+XVSc0tW08Y='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co https://vercel.com/api/blob/; upgrade-insecure-requests";
export const CUSTOMIZE_CSP = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; upgrade-insecure-requests";
export const customizeCsp = () => CUSTOMIZE_CSP;
