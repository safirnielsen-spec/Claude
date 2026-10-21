# Stripe til abonnement (kort og faktura)

Rækkefølge:

1. Kør `subscription.sql` og derefter `stripe.sql` i Supabase → SQL Editor.
2. Opret priserne i Stripe (testtilstand først):
   `STRIPE_SECRET_KEY=sk_test_... node setup-prices.mjs`
   Scriptet opretter seks priser med nøglerne `platform_start_month`, `platform_start_year`, `platform_vaekst_month`, ... (DKK, ekskl. moms, årlig = 10 måneder).
3. Supabase → Edge Functions → opret tre funktioner og indsæt koden fra `functions/*/index.ts`:
   - `create-checkout` (Verify JWT: til)
   - `billing-portal` (Verify JWT: til)
   - `stripe-webhook` (Verify JWT: **fra**)
4. Supabase → Edge Functions → Secrets:
   - `STRIPE_SECRET_KEY` (helst en begrænset nøgle, `rk_...`, med skriveadgang til Customers, Checkout Sessions, Subscriptions, Customer portal Sessions og læseadgang til Prices)
   - `STRIPE_WEBHOOK_SECRET` (fra trin 5)
   - `SITE_URL` = `https://www.corepartners.dk`
   - valgfrit `STRIPE_AUTOMATIC_TAX` = `1`, hvis Stripe Tax er sat op
5. Stripe → Developers → Webhooks → tilføj endpoint `https://<projekt>.supabase.co/functions/v1/stripe-webhook` med events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
   Kopiér signeringshemmeligheden (`whsec_...`) til trin 4.
6. Stripe → Settings → Billing → Customer portal: aktivér portalen. Settings → Billing → Invoices: aktivér e-mails til kunder.
7. I `platform/config.js`: sæt `stripeCheckout: true`.

Test med testkort 4242 4242 4242 4242 før I skifter til live-nøgler.
