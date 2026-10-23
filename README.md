# Zilcycler Record Management System

Daily output and payroll tracking for a PET recycling facility. Two worker pipelines —
**Sorters** (paid per kg of PET / Covers) and **Balers** (paid per bale) — with locked
payouts, an advances/deductions ledger that nets down to real transfer amounts, a
single-admin login, and Excel / CSV payroll exports plus per-worker payslip PDFs.

Built per PRD v2: **React (Vite) + Netlify Functions + Neon PostgreSQL**.

---

## What's implemented

- **Auth** — single admin, bcrypt password, JWT in an httpOnly cookie, 20-minute idle auto-logout, optional Upstash login rate limiting.
- **Dashboard** — today + rolling 7/30-day output (PET kg, Cover kg, bales), expected payout, top-3 sorters and balers, a **30-day trend chart**, and a **daily-completeness panel** flagging active workers with no record for a chosen date.
- **Pricing** — three global rates. Changing them affects future entries only.
- **Workers** — add / edit / deactivate. Bank name + 10-digit NUBAN, **AES-256-GCM encrypted at rest**.
- **Daily entry** — separate Sorter / Baler workflows with a live payout preview; one record per worker per day. A **bulk single-date grid** enters (or edits) every active worker of a role in one batch.
- **Advances & deductions** — a `worker_adjustments` ledger (advance / deduction / bonus). These net against gross so the export and payslips show **what you actually transfer**.
- **Records** — filter by date range / worker / material, edit (keep locked rate or re-price at today's rate), soft-delete with audit log.
- **Export** — `.xlsx` or `.csv` for a month or custom range. The workbook has six sheets: *Sorters · PET*, *Sorters · PET by Type* (each sorter's kg of Clear, Oily, Brown, Green, Viju, Freshyo, Blue and Black), *Sorters · PET Daily* (the same breakdown per day), *Sorters · Covers*, *Balers*, and a *Payment Summary* (gross → advances → deductions → bonus → **net pay**) for the bank transfer. CSV gives the same data unformatted — raw records (one column per PET type) or the netted summary. Account numbers export as text; payouts as ₦ currency.
- **Payslip** — per-worker PDF for a period: daily output breakdown, gross, advances/adjustments, net pay, and bank details.

The pricing model from the PRD is enforced in the schema: rates are **snapshotted onto each
record** and `payout` is a Postgres `GENERATED` column, so historical pay never drifts. Net
pay nets only adjustments **dated within the selected period** against that period's gross.

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
| GET POST PUT DELETE | `/api/records` | Daily records (DELETE = soft). POST with `{date, entries:[…]}` bulk-upserts |
| GET POST DELETE | `/api/adjustments` | Advances / deductions / bonuses ledger (DELETE = soft) |
| GET | `/api/dashboard` | Aggregated metrics + 30-day trend |
| GET | `/api/completeness?date=YYYY-MM-DD` | Active workers with / without a record for a date |
| GET | `/api/export?month=YYYY-MM` or `?from&to` | Download `.xlsx`; add `&format=csv&csv=records\|summary` for CSV |
| GET | `/api/payslip?worker_id=…&month=YYYY-MM` or `&from&to` | Download a worker's payslip `.pdf` |

---

## Notes & decisions (from PRD v2 §8)

- **One record per worker per day** — enforced by a partial unique index. A second same-day entry is rejected; edit the existing one.
- **Export columns = worked days only** within the selected range.
- **Dashboard periods = rolling 7 / 30 days**, computed in **Africa/Lagos**.
- **Editing** keeps the originally snapshotted rate unless "re-price at today's rates" is ticked.
- **Net pay** = gross − advances − deductions + bonuses, netting only adjustments dated within the export period (no carry-over). To switch to outstanding-balance tracking you'd add a `settled` flag to `worker_adjustments` and adjust the aggregation in `netlify/functions/export.js` / `payslip.js`.
- **Bulk entry upserts**: blank grid rows are skipped (not zeroed); existing same-day records are updated in place via `ON CONFLICT … WHERE deleted_at IS NULL`.

To change any of these, the relevant spots are: the unique index in `db/schema.sql`, the date
loop in `netlify/functions/export.js`, and the window math in `netlify/functions/dashboard.js`.

## Backups
Neon provides point-in-time recovery. The schema also keeps a `record_audit` trail and
`settings_history`; nothing is hard-deleted.
