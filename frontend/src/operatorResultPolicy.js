import {
  FALLBACK_OPERATOR_OUTCOMES,
  findOutcome,
} from './domain/outcomeCatalog';

export const OPERATOR_RESULT_LABELS = FALLBACK_OPERATOR_OUTCOMES.map((item) => item.label);

export const FIXED_INVALID_REASON_LABELS = FALLBACK_OPERATOR_OUTCOMES
  .filter((item) => item.invalidReason)
  .map((item) => item.label);

export const RESULT_DETAIL_LABELS = FALLBACK_OPERATOR_OUTCOMES
  .filter((item) => item.statusDetail)
  .map((item) => item.label);

export const RESULT_TO_DISPLAY_STATUS = Object.fromEntries(
  FALLBACK_OPERATOR_OUTCOMES.map((item) => [item.label, item.displayStatus]),
);

export function isFixedInvalidReason(input) {
  return Boolean(findOutcome(input)?.invalidReason);
}

export function displayStatusForOperatorResult(input) {
  const outcome = findOutcome(input);
  const fallback = typeof input === 'string' ? input : input?.label || input?.status;
  return outcome?.displayStatus || fallback;
}

export function detailForOperatorResult(input) {
  return findOutcome(input)?.statusDetail || '';
}

export function resolveOperatorResult(input) {
  const outcome = findOutcome(input);
  const rawStatus = typeof input === 'string' ? input : input?.label || input?.status;
  const explicitInvalidReason = typeof input === 'object'
    ? input.invalid_reason || input.invalidReason
    : undefined;
  const invalidReason = explicitInvalidReason || outcome?.invalidReason || undefined;
  const status = outcome?.status || (typeof input === 'object' ? input?.status : input);
  return {
    status,
    invalidReason,
    originalStatus: outcome?.label || rawStatus,
    fixedInvalid: Boolean(outcome?.invalidReason),
  };
}

export function payloadForOperatorResult(input) {
  const result = resolveOperatorResult(input);
  return result.invalidReason
    ? { status: result.status, invalid_reason: result.invalidReason }
    : { status: result.status };
}
