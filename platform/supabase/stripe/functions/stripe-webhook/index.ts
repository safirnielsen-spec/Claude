// Supabase Edge Function: stripe-webhook
// Opdaterer abonnementsstatus på organisationen, når Stripe melder om betaling og ændringer.
// Slå "Verify JWT" FRA for denne funktion (Stripe sender ikke et Supabase-login). Sikkerheden ligger i signaturen.
// Hemmeligheder: STRIPE_WEBHOOK_SECRET (whsec_...). Events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed
const SB_URL = Deno.env.get('SUPABASE_URL');
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WH = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const enc = new TextEncoder();

async function verify(payload, header, secret) {
  const parts = (header || '').split(',').map(x => x.trim().split('='));
  const t = (parts.find(p => p[0] === 't') || [])[1];
  const sigs = parts.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const hex = Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}
const sb = (path, init = {}) => fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const STATUS = { trialing: 'trial', active: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled', incomplete_expired: 'cancelled' };

async function orgIdFor(obj) {
  if (obj.client_reference_id) return obj.client_reference_id;
  if (obj.metadata && obj.metadata.org_id) return obj.metadata.org_id;
  if (obj.subscription_details && obj.subscription_details.metadata && obj.subscription_details.metadata.org_id) return obj.subscription_details.metadata.org_id;
  if (obj.customer) {
    const r = await sb(`organizations?stripe_customer_id=eq.${obj.customer}&select=id`).then(x => x.json());
    return r[0] && r[0].id;
  }
}
async function update(orgId, patch) {
  if (!orgId) return;
  const r = await sb(`organizations?id=eq.${orgId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!r.ok) throw new Error('Kunne ikke opdatere organisation: ' + await r.text());
}

Deno.serve(async req => {
  const payload = await req.text();
  if (!WH || !(await verify(payload, req.headers.get('stripe-signature'), WH))) return new Response('Ugyldig signatur', { status: 400 });
  const ev = JSON.parse(payload);
  const o = ev.data.object;
  try {
    if (ev.type === 'checkout.session.completed') {
      await update(await orgIdFor(o), { stripe_customer_id: o.customer, stripe_subscription_id: o.subscription });
    } else if (ev.type.startsWith('customer.subscription.')) {
      const st = ev.type.endsWith('.deleted') ? 'cancelled' : STATUS[o.status];
      if (st) await update(await orgIdFor(o), { plan_status: st, stripe_customer_id: o.customer, stripe_subscription_id: o.id, ...(st === 'active' ? { subscribed_at: new Date().toISOString() } : {}) });
    } else if (ev.type === 'invoice.paid') {
      // Nulfakturaen ved prøvestart er også 'paid', så kun rigtige betalinger gør abonnementet aktivt
      if (o.amount_paid > 0) await update(await orgIdFor(o), { plan_status: 'active', subscribed_at: new Date().toISOString() });
    } else if (ev.type === 'invoice.payment_failed') {
      await update(await orgIdFor(o), { plan_status: 'past_due' });
    }
  } catch (e) {
    return new Response(String(e.message || e), { status: 500 }); // Stripe prøver igen
  }
  return new Response('ok');
});
