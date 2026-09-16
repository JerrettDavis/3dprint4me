/** Refuse synthetic submissions unless the actual target explicitly disables delivery. */
export async function requireDisabledRemoteDelivery(base,transport=fetch) {
  let disabled=false;
  try {
    const response=await transport(new URL('/api/health',base),{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.ok) {
      const health=await response.json();
      disabled=health?.integrations?.email === false && health?.integrations?.webhook === false;
    }
  } catch { /* Fail closed without exposing remote response bodies or network details. */ }
  if(!disabled) throw new Error('Synthetic verification refused: target email and webhook delivery must both be explicitly disabled in /api/health.');
}
