const outcomeStyles = {
  new_lead: 'bg-gray-500 hover:bg-gray-600',
  very_interested: 'bg-red-600 hover:bg-red-700',
  interested_wechat: 'bg-amber-600 hover:bg-amber-700',
  missed_call: 'bg-gray-600 hover:bg-gray-700',
  phone_invalid: 'bg-stone-600 hover:bg-stone-700',
  high_score: 'bg-indigo-600 hover:bg-indigo-700',
  no_intent: 'bg-slate-600 hover:bg-slate-700',
  child_declined: 'bg-zinc-600 hover:bg-zinc-700',
  enrolled_elsewhere: 'bg-rose-600 hover:bg-rose-700',
  enrolled: 'bg-green-600 hover:bg-green-700',
  other: 'bg-gray-600 hover:bg-gray-700',
};

function workflowOutcome(code, label, status, displayStatus, statusDetail = '') {
  return {
    code,
    label,
    status,
    displayStatus,
    statusDetail,
    invalidReason: '',
    terminal: code === 'enrolled',
    reclaimable: false,
    operatorVisible: true,
    className: outcomeStyles[code],
  };
}

function invalidOutcome(code, label, reclaimable = true, operatorVisible = true) {
  return {
    code,
    label,
    status: '无效',
    displayStatus: '无效',
    statusDetail: label,
    invalidReason: label,
    terminal: true,
    reclaimable,
    operatorVisible,
    className: outcomeStyles[code] || outcomeStyles.other,
  };
}

export const FALLBACK_OUTCOME_CATALOG = [
  workflowOutcome('new_lead', '新线索', '新线索', '未联系'),
  workflowOutcome('very_interested', '非常有意向', '非常有意向', '已联系', '非常有意向'),
  workflowOutcome('interested_wechat', '意向了解加微', '意向了解加微', '待回访', '意向了解加微'),
  workflowOutcome('missed_call', '未接', '未接', '未接'),
  invalidOutcome('phone_invalid', '空号'),
  invalidOutcome('high_score', '高分段'),
  invalidOutcome('no_intent', '无意向'),
  invalidOutcome('child_declined', '孩子不想读'),
  invalidOutcome('enrolled_elsewhere', '已报名其他学校', false),
  workflowOutcome('enrolled', '已报名', '已报名', '已报名'),
  invalidOutcome('other', '其他', true, false),
];

export const FALLBACK_OPERATOR_OUTCOMES = FALLBACK_OUTCOME_CATALOG.filter(
  (item) => item.operatorVisible,
);

const fallbackByCode = Object.fromEntries(
  FALLBACK_OUTCOME_CATALOG.map((item) => [item.code, item]),
);
const serverManagedCodes = new Set(
  FALLBACK_OUTCOME_CATALOG.filter((item) => item.invalidReason).map((item) => item.code),
);

function normalizeServerOutcome(value) {
  const fallback = fallbackByCode[value?.code];
  if (!fallback || !serverManagedCodes.has(fallback.code)) return null;
  const label = typeof value.label === 'string' && value.label.trim()
    ? value.label.trim()
    : fallback.label;
  return {
    ...fallback,
    label,
    statusDetail: label,
    invalidReason: label,
    terminal: value.terminal === undefined ? fallback.terminal : Boolean(value.terminal),
    reclaimable:
      value.reclaimable === undefined ? fallback.reclaimable : Boolean(value.reclaimable),
  };
}

export function resolveOutcomeCatalog(serverValues) {
  if (!Array.isArray(serverValues)) return FALLBACK_OUTCOME_CATALOG;
  const managed = serverValues.map(normalizeServerOutcome).filter(Boolean);
  const firstManagedIndex = FALLBACK_OUTCOME_CATALOG.findIndex(
    (item) => serverManagedCodes.has(item.code),
  );
  const unmanaged = FALLBACK_OUTCOME_CATALOG.filter(
    (item) => !serverManagedCodes.has(item.code),
  );
  const prefix = unmanaged.filter(
    (item) => FALLBACK_OUTCOME_CATALOG.indexOf(item) < firstManagedIndex,
  );
  const suffix = unmanaged.filter(
    (item) => FALLBACK_OUTCOME_CATALOG.indexOf(item) >= firstManagedIndex,
  );
  return [...prefix, ...managed, ...suffix];
}

export function outcomeCatalogByCode(catalog = FALLBACK_OUTCOME_CATALOG) {
  return Object.fromEntries(catalog.map((item) => [item.code, item]));
}

export function findOutcome(input, catalog = FALLBACK_OUTCOME_CATALOG) {
  if (input && typeof input === 'object') {
    if (input.code) {
      if (input.displayStatus || input.invalidReason !== undefined) return input;
      return catalog.find((item) => item.code === input.code) || input;
    }
    const value = input.label || input.status;
    return catalog.find((item) => item.label === value || item.status === value) || input;
  }
  return catalog.find((item) => item.code === input || item.label === input || item.status === input);
}

export function isOutcomeReclaimable(value, byCode = fallbackByCode) {
  const outcome = value?.outcome_reason_code
    ? byCode[value.outcome_reason_code]
    : Object.values(byCode).find((item) => item.label === value?.invalid_reason);
  return outcome?.reclaimable !== false;
}
