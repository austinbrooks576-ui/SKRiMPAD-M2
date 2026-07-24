// ============================================================================
// SKRiMPAD commerce backend
// Checkout (Stripe + PayPal), webhooks that issue license keys, license
// validation, and download gating. Designed to run behind the habitflow.ink
// backend. Everything account-specific comes from env (.env.example) — paste
// YOUR keys there; no secrets live in this file.
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const { createLicenses } = require('./lib/licenses');

const cfg = {
  port: process.env.PORT || 8787,
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:8787',
  siteUrl: process.env.SITE_URL || 'http://localhost:5173',
  origins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  stripeKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWh: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePrice: { consumer: process.env.STRIPE_PRICE_CONSUMER, vga: process.env.STRIPE_PRICE_VGA, se: process.env.STRIPE_PRICE_SE },
  paypalEnv: process.env.PAYPAL_ENV || 'sandbox',
  paypalId: process.env.PAYPAL_CLIENT_ID || '',
  paypalSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || '',
};
const PRICES = { consumer: 300, vga: 600, se: 900 };   // cents
const DOWNLOADS = {
  consumer: { apk: process.env.DL_CONSUMER_APK, win: process.env.DL_CONSUMER_WIN },
  vga: { apk: process.env.DL_VGA_APK, win: process.env.DL_VGA_WIN },
  se: { apk: process.env.DL_SE_APK, win: process.env.DL_SE_WIN },
  live: { url: process.env.DL_LIVE_URL },
};

const licenses = createLicenses({ secret: process.env.LICENSE_SIGNING_SECRET || 'dev-insecure-secret-change-me-please' });
const stripe = cfg.stripeKey ? require('stripe')(cfg.stripeKey) : null;
const app = express();

// ---- CORS (explicit allow-list) ----
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && (cfg.origins.length === 0 || cfg.origins.includes(o))) {
    res.set('Access-Control-Allow-Origin', o);
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Stripe webhook needs the RAW body for signature checks — mount it BEFORE json().
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !cfg.stripeWh) return res.status(503).send('stripe not configured');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], cfg.stripeWh); }
  catch (e) { return res.status(400).send('bad signature: ' + e.message); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const edition = s.metadata && s.metadata.edition;
    if (edition && PRICES[edition]) {
      const rec = licenses.issue({ edition, email: s.customer_details && s.customer_details.email, source: 'stripe', ref: s.id });
      deliverLicense(rec).catch(() => {});
    }
  }
  res.json({ received: true });
});

app.use(express.json());

// ---- health ----
app.get('/health', (_req, res) => res.json({ ok: true, stripe: !!stripe, paypal: !!cfg.paypalId, editions: Object.keys(PRICES) }));

// ---- CHECKOUT: returns { url } the storefront redirects to ----
app.post('/checkout', async (req, res) => {
  const { edition, provider } = req.body || {};
  if (edition === 'live') return res.json({ url: DOWNLOADS.live.url });
  if (!PRICES[edition]) return res.status(400).json({ error: 'unknown edition' });
  try {
    if (provider === 'paypal') return res.json({ url: await paypalCreateOrder(edition) });
    // default: Stripe Checkout
    if (!stripe) return res.status(503).json({ error: 'stripe not configured' });
    const priceId = cfg.stripePrice[edition];
    const line = priceId
      ? { price: priceId, quantity: 1 }
      : { quantity: 1, price_data: { currency: 'usd', unit_amount: PRICES[edition], product_data: { name: 'SKRiMPAD ' + edition.toUpperCase() } } };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', line_items: [line], metadata: { edition },
      success_url: cfg.siteUrl + '/thanks?session={CHECKOUT_SESSION_ID}&edition=' + edition,
      cancel_url: cfg.siteUrl + '/#pricing',
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PayPal capture (buyer returns here) → issue license ----
app.get('/paypal/return', async (req, res) => {
  try {
    const { token, edition } = req.query;
    const cap = await paypalCapture(token);
    if (cap && cap.status === 'COMPLETED') {
      const email = cap.payer && cap.payer.email_address;
      const rec = licenses.issue({ edition, email, source: 'paypal', ref: token });
      deliverLicense(rec).catch(() => {});
      return res.redirect(cfg.siteUrl + '/thanks?license=' + encodeURIComponent(rec.key) + '&edition=' + edition);
    }
    res.redirect(cfg.siteUrl + '/#pricing');
  } catch (e) { res.status(500).send(e.message); }
});

// ---- LICENSE VALIDATION (called by the app on launch / by /download) ----
app.post('/license/validate', (req, res) => {
  const r = licenses.validate((req.body || {}).key);
  if (r.valid) licenses.recordActivation((req.body).key);
  res.json(r);
});

// ---- look up the license issued for a Stripe session (thank-you page) ----
// The webhook usually issues first, but the success redirect can beat it — so
// if nothing's recorded yet, confirm the session is paid and issue on the spot
// (idempotent: we reuse an existing record for the same session).
app.get('/license/by-session', async (req, res) => {
  const session = req.query.session;
  if (!session) return res.status(400).json({ error: 'missing session' });
  let rec = licenses.store.all().find(r => r.source === 'stripe' && r.ref === session);
  if (!rec && stripe) {
    try {
      const s = await stripe.checkout.sessions.retrieve(session);
      const edition = s.metadata && s.metadata.edition;
      if (s.payment_status === 'paid' && edition && PRICES[edition]) {
        rec = licenses.issue({ edition, email: s.customer_details && s.customer_details.email, source: 'stripe', ref: session });
        deliverLicense(rec).catch(() => {});
      }
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }
  if (!rec) return res.status(404).json({ error: 'not found yet' });
  res.json({ key: rec.key, edition: rec.edition });
});

// ---- GOOGLE PLAY: verify a Play purchase token, issue a license ----
// Full verification uses the Play Developer API with GOOGLE_PLAY_SA_JSON. Left
// as a clear integration point — wire androidpublisher.purchases.products.get.
app.post('/play/verify', async (req, res) => {
  const { productId, purchaseToken, edition } = req.body || {};
  if (!PRICES[edition]) return res.status(400).json({ error: 'unknown edition' });
  // TODO: verify (productId, purchaseToken) with the Play Developer API before issuing.
  if (!purchaseToken) return res.status(400).json({ error: 'missing purchaseToken' });
  const rec = licenses.issue({ edition, source: 'play', ref: purchaseToken });
  res.json({ license: rec.key, edition });
});

// ---- DOWNLOAD GATING: hand back the artifact URL for a valid license ----
app.get('/download', (req, res) => {
  const { key, edition, platform } = req.query;
  if (edition === 'live') return res.redirect(DOWNLOADS.live.url);
  const v = licenses.validate(key);
  if (!v.valid) return res.status(403).json({ error: 'invalid license', reason: v.reason });
  if (v.edition !== edition) return res.status(403).json({ error: 'license is for ' + v.edition + ', not ' + edition });
  const url = (DOWNLOADS[edition] || {})[platform];
  if (!url) return res.status(404).json({ error: 'no build for ' + edition + '/' + platform });
  res.redirect(url);
});

// ---- delivery: email the license to the buyer (plug in your mailer) ----
async function deliverLicense(rec) {
  // Integration point: send rec.key to rec.email via your email provider
  // (SendGrid/Resend/etc.). Logged for now so nothing is lost pre-wiring.
  console.log('[license issued]', rec.edition, rec.key, '→', rec.email || '(no email captured)');
}

// ---- PayPal REST helpers ----
function paypalBase() { return cfg.paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'; }
async function paypalToken() {
  const r = await fetch(paypalBase() + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(cfg.paypalId + ':' + cfg.paypalSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('paypal token ' + r.status);
  return (await r.json()).access_token;
}
async function paypalCreateOrder(edition) {
  const tok = await paypalToken();
  const r = await fetch(paypalBase() + '/v2/checkout/orders', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: (PRICES[edition] / 100).toFixed(2) },
        description: 'SKRiMPAD ' + edition.toUpperCase() }],
      application_context: {
        return_url: cfg.publicUrl + '/paypal/return?edition=' + edition,
        cancel_url: cfg.siteUrl + '/#pricing', brand_name: 'SKRiMPAD', user_action: 'PAY_NOW' },
    }),
  });
  const o = await r.json();
  if (!r.ok) throw new Error('paypal order ' + r.status + ' ' + JSON.stringify(o));
  const approve = (o.links || []).find(l => l.rel === 'approve');
  if (!approve) throw new Error('no approval link');
  return approve.href;
}
async function paypalCapture(orderId) {
  const tok = await paypalToken();
  const r = await fetch(paypalBase() + '/v2/checkout/orders/' + orderId + '/capture', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
  });
  const o = await r.json();
  // pull payer + status into a flat shape
  const cap = (((o.purchase_units || [])[0] || {}).payments || {}).captures || [];
  return { status: (cap[0] && cap[0].status) || o.status, payer: o.payer };
}

app.listen(cfg.port, () => console.log('SKRiMPAD backend on :' + cfg.port + ' (stripe=' + !!stripe + ' paypal=' + !!cfg.paypalId + ')'));

module.exports = app; // for tests
