// All "today"/period logic must use Africa/Lagos (UTC+1, no DST),
// because the function runtime is UTC.

const TZ = 'Africa/Lagos';

// Returns YYYY-MM-DD for "now" in Lagos.
export function todayLagos() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA already yields YYYY-MM-DD
}

// YYYY-MM-DD that is `days` before today (Lagos). days=0 -> today.
export function daysAgoLagos(days) {
  const today = todayLagos();
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// First and last day (YYYY-MM-DD) of a calendar month. month is 1-12.
export function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
