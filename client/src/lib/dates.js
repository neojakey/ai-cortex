// The user's local calendar date as YYYY-MM-DD.
// Not toISOString(): that is UTC, so in the evening west of Greenwich it already reports tomorrow.
export function localDateString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
