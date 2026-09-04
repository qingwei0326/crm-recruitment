/**
 * Helpers shared by the mobile and desktop follow-up/visit forms.
 *
 * Browser datetime-local inputs use the user's local timezone and omit
 * seconds. The API accepts the same value with optional seconds appended.
 */

function pad(value) {
  return String(value).padStart(2, '0');
}

export function toDateTimeLocalValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeDateTimeLocal(value) {
  if (!value) return '';
  const normalized = String(value).replace(' ', 'T');
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
}

export function toApiDateTime(value) {
  if (!value) return '';
  const normalized = String(value).trim().replace(' ', 'T');
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

export function dateTimeAfterDays(days, hour = 9, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return toDateTimeLocalValue(date);
}

export function defaultFollowUpDate() {
  return dateTimeAfterDays(1, 9, 0);
}

export function defaultVisitDate() {
  return dateTimeAfterDays(1, 10, 0);
}

export function defaultMissedFollowUpDate() {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  date.setSeconds(0, 0);
  return toDateTimeLocalValue(date);
}

export function laterTodayOrTomorrowDate() {
  const now = new Date();
  const date = new Date(now);
  date.setHours(17, 30, 0, 0);
  if (date <= now) return dateTimeAfterDays(1, 9, 0);
  return toDateTimeLocalValue(date);
}
