const BASE = '/api';

async function req(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // auth
  session: () => req('/session'),
  login: (email, password) => req('/login', { method: 'POST', body: { email, password } }),
  logout: () => req('/session', { method: 'POST' }),
  // settings
  getSettings: () => req('/settings'),
  saveSettings: (s) => req('/settings', { method: 'PUT', body: s }),
  // workers
  listWorkers: (activeOnly) => req(`/workers${activeOnly ? '?active=1' : ''}`),
  addWorker: (w) => req('/workers', { method: 'POST', body: w }),
  updateWorker: (id, w) => req(`/workers?id=${id}`, { method: 'PUT', body: w }),
  setWorkerActive: (id, is_active) => req(`/workers?id=${id}`, { method: 'PATCH', body: { is_active } }),
  // records
  listRecords: (q = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return req(`/records?${p.toString()}`);
  },
  addRecord: (r) => req('/records', { method: 'POST', body: r }),
  bulkRecords: (date, entries) => req('/records', { method: 'POST', body: { date, entries } }),
  updateRecord: (id, r) => req(`/records?id=${id}`, { method: 'PUT', body: r }),
  deleteRecord: (id) => req(`/records?id=${id}`, { method: 'DELETE' }),
  // adjustments (advances / deductions / bonuses)
  listAdjustments: (q = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return req(`/adjustments?${p.toString()}`);
  },
  addAdjustment: (a) => req('/adjustments', { method: 'POST', body: a }),
  deleteAdjustment: (id) => req(`/adjustments?id=${id}`, { method: 'DELETE' }),
  // dashboard
  dashboard: () => req('/dashboard'),
  completeness: (date) => req(`/completeness${date ? `?date=${date}` : ''}`),
  // export -> returns a Response for blob download
  exportBlob: (q) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return req(`/export?${p.toString()}`, { raw: true });
  },
  // payslip PDF -> returns a Response for blob download
  payslipBlob: (q) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return req(`/payslip?${p.toString()}`, { raw: true });
  },
};

export const naira = (n) =>
  '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kg = (n) =>
  (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
export const intf = (n) => (Number(n) || 0).toLocaleString('en-NG');
