# Zilcycler Record Management System

Daily output and payroll tracking for a PET recycling facility. Two worker pipelines —
**Sorters** (paid per kg of PET / Covers) and **Balers** (paid per bale) — with locked
payouts, a single-admin login, and a four-sheet Excel payroll export.

Built per PRD v2: **React (Vite) + Netlify Functions + Neon PostgreSQL**.

---

## What's implemented

- **Auth** — single admin, bcrypt password, JWT in an httpOnly cookie, 20-minute idle auto-logout, optional Upstash login rate limiting.
- **Dashboard** — today + rolling 7/30-day output (PET kg, Cover kg, bales), expected payout, top-3 sorters and balers.
- **Pricing** — three global rates. Changing them affects future entries only.
- **Workers** — add / edit / deactivate. Bank name + 10-digit NUBAN, **AES-256-GCM encrypted at rest**.
- **Daily entry** — separate Sorter / Baler workflows with a live payout preview; one record per worker per day.
- **Records** — filter by date range / worker / material, edit (keep locked rate or re-price at today's rate), soft-delete with audit log.
- **Export** — `.xlsx` for a month or custom range: *Sorters · PET*, *Sorters · Covers*, *Balers*, and a *Payment Summary* sheet for the bank transfer. Account numbers export as text; payouts as ₦ currency.

The pricing model from the PRD is enforced in the schema: rates are **snapshotted onto each
record** and `payout` is a Postgres `GENERATED` column, so historical pay never drifts.

---

## Setup

### 1. Create the Neon database
Create a project at neon.tech, then run the schema (use the **pooled** connection string):

```bash
psql "postgresql://...-pooler.../zilcycler?sslmode=require" -f db/schema.sql
```

### 2. Configure environment
Copy `.env.example` to `.env` and fill it in.

```bash
cp .env.example .env
node db/hash-admin.js 'your-admin-password'     # -> paste into ADMIN_PASSWORD_HASH
openssl rand -base64 48                         # -> JWT_SECRET
openssl rand -base64 32                         # -> ENCRYPTION_KEY (must be 32 bytes)
```

> Keep `ENCRYPTION_KEY` stable. If it changes, existing encrypted bank fields can't be decrypted.

### 3. Run locally
```bash
npm install
npm run dev        # Netlify Dev: serves the SPA + functions together
```
(`netlify dev` needs the Netlify CLI: `npm i -g netlify-cli`. Without it, `npm run dev:vite`
runs the frontend only — functions won't respond.)

### 4. Deploy to Netlify
- Push to GitHub and "Add new site → Import" in Netlify, **or** `netlify deploy --prod`.
- Build settings come from `netlify.toml` (build `npm run build`, publish `dist`, functions `netlify/functions`).
- Add the same environment variables in **Site settings → Environment variables**.

---

## API surface

All under `/api/*` (redirected to `/.netlify/functions/*`). Every endpoint except `/api/login` requires the session cookie.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Authenticate, set cookie |
| GET / POST | `/api/session` | Check session / log out |
| GET / PUT | `/api/settings` | Read / update pricing |
| GET POST PUT PATCH | `/api/workers` | Directory CRUD + activate toggle |
| GET POST PUT DELETE | `/api/records` | Daily records (DELETE = soft) |
| GET | `/api/dashboard` | Aggregated metrics |
| GET | `/api/export?month=YYYY-MM` or `?from&to` | Download `.xlsx` |

---

## Notes & decisions (from PRD v2 §8)

- **One record per worker per day** — enforced by a partial unique index. A second same-day entry is rejected; edit the existing one.
- **Export columns = worked days only** within the selected range.
- **Dashboard periods = rolling 7 / 30 days**, computed in **Africa/Lagos**.
- **Editing** keeps the originally snapshotted rate unless "re-price at today's rates" is ticked.

To change any of these, the relevant spots are: the unique index in `db/schema.sql`, the date
loop in `netlify/functions/export.js`, and the window math in `netlify/functions/dashboard.js`.

## Backups
Neon provides point-in-time recovery. The schema also keeps a `record_audit` trail and
`settings_history`; nothing is hard-deleted.
