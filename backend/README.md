# SKRiMPAD commerce backend

Checkout + licensing + download gating for the four editions. Runs behind
**habitflow.ink**; the **scrimpad.ink** front-end calls it. No account secrets
live in the code — you paste them into `.env`.

## What it does

| Endpoint | Purpose |
|---|---|
| `POST /checkout` | Creates a Stripe Checkout session (or PayPal order) for an edition → returns `{ url }`. |
| `POST /webhook/stripe` | On paid checkout, **issues a license key** and delivers it. |
| `GET /paypal/return` | Captures a PayPal order, issues a license, redirects to the thank-you page. |
| `POST /play/verify` | Verifies a Google Play purchase token → issues a license. |
| `POST /license/validate` | The app calls this on launch to check a key. |
| `GET /download` | Hands back the build URL **only** for a valid license. |
| `GET /health` | Liveness + which providers are configured. |

Editions & prices: **Live $0 · Consumer $3 · VGA $6 · SE $9**. License keys look
like `SKRM-S-XXXXXXXX-XXXXXXXX` (edition letter + signed payload) and are
HMAC-signed so the app can verify them offline, plus recorded so you can revoke.

## Setup (the parts only you can do)

1. `cp .env.example .env` and fill in every value. Generate the signing secret:
   `openssl rand -hex 32`.
2. **Stripe** — create three Products/Prices ($3/$6/$9), paste the price IDs and
   your secret key. Add a webhook to `https://habitflow.ink/api/scrimpad/webhook/stripe`
   for the `checkout.session.completed` event; paste its signing secret.
3. **PayPal** — create a REST app, paste client id/secret, set `PAYPAL_ENV=live`.
4. **Google Play** — create a service account with Play Developer API access,
   drop the JSON at `GOOGLE_PLAY_SA_JSON`, and finish the `TODO` in `/play/verify`.
5. `npm install && npm start`.

## Storage

Licenses persist to `data/licenses.json` by default (zero-infra). For production,
pass your own store to `createLicenses({ store })` in `lib/licenses.js` —
`{ get(key), put(key, rec), all() }` backed by Postgres/Redis.

## Deploy

Any Node host works. Behind the habitflow.ink reverse proxy, route
`/api/scrimpad/*` here and set `PUBLIC_URL` to that path. Keep `.env` out of
version control (see `.gitignore`).
