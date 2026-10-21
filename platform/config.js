// Udfyld med værdierne fra Supabase → Project Settings → API.
// Så længe felterne er tomme, kører platformen i demo-tilstand med data gemt lokalt i browseren.
window.CP_CONFIG = {
  supabaseUrl: 'https://coghnjyigoizhiqwqazw.supabase.co',
  // Offentlig nøgle (publishable). Sikker at have i koden; adgang styres af Row Level Security.
  supabaseAnonKey: 'sb_publishable_EYA-mcCIxLT7QURJgEyWrg_rH7qfAqE',
  // Hvor Core Partners-knappen "Book gennemgang" peger hen.
  contactEmail: 'kontakt@corepartners.dk',
  // Sæt til true, når Edge Functions (create-checkout, billing-portal, stripe-webhook) er udrullet. Så starter kort/faktura via Stripe.
  stripeCheckout: false,
  // Offentlig Stripe-nøgle (testtilstand). Bruges ikke af Checkout-flowet, men gemmes her til evt. Stripe.js.
  stripePublishableKey: 'pk_test_51UQsXSFxeSHE6optlrWKg7lwfHS4IUkhJ5zpZjeMAkUdSydP5ya6Kgv16nFg0NuVENFF2aCuBX1cg1rXr1TUn68B001ZCUC7l5',
  // Betalingslinks fra Stripe (Payment Links, abonnement). Tomme = kortbetaling aftales på mail.
  stripeLinks: { start_month: '', start_year: '', vaekst_month: '', vaekst_year: '', portefolje_month: '', portefolje_year: '' }
};
