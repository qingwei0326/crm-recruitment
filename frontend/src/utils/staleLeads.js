// The API's days_since_assigned counts whole 24-hour periods, so >= 1 means the
// lead has been waiting at least 24 hours. A lead handed out late last night is
// not stale yet, even though it was assigned on a previous calendar day.
export const STALE_AFTER_DAYS = 1;

export function selectStaleLeads(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item) => item.days_since_assigned == null || item.days_since_assigned >= STALE_AFTER_DAYS,
  );
}
