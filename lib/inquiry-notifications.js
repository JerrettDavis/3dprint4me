export async function sendInquiryEmail(id,payload,transport=fetch) {
  const response=await transport('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`quick-inquiry/${id}/owner`},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok) throw new Error('Inquiry notification unavailable.');
}
