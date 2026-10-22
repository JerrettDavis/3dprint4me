const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const describe = value => [value.material, value.brandLine, value.color, value.colorHex].filter(Boolean).join(' · ');
export function substitutionMessage({ requestId, recipient, proposal }) {
  const subject = `Filament substitution approval · ${requestId}`;
  const text = `Request ${requestId}\nSubstitution ${proposal.id}\n\nRequested: ${describe(proposal.requested)}\nProposed: ${describe(proposal.offered)}\n\nDigital colors are approximate; physical appearance may vary.\nPlease reply to this email accepting or declining this substitution. We will record your response before using it.\n\n3dprint4.me`;
  return { recipient, subject, text, html: `<p>${escape(text).replaceAll('\n', '<br>')}</p>` };
}

// Resend retains Idempotency-Key for 24h. Application retries are limited to 23h.
// https://resend.com/docs/dashboard/emails/idempotency-keys
export function createSubstitutionEmailDelivery({ env = process.env, fetchImpl = fetch } = {}) {
  return async (message, idempotencyKey) => {
    if (!env.RESEND_API_KEY || !env.REQUEST_FROM_EMAIL || !env.REQUEST_TO_EMAIL) return { state: 'unconfigured' };
    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from: env.REQUEST_FROM_EMAIL, to: [message.recipient], reply_to: env.REQUEST_TO_EMAIL, subject: message.subject, html: message.html, text: message.text }), signal: AbortSignal.timeout(10000)
      });
      return { state: response.ok ? 'sent' : response.status >= 500 || response.status === 409 ? 'uncertain' : 'failed' };
    } catch { return { state: 'uncertain' }; }
  };
}
