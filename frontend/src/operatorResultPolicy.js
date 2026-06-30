export const OPERATOR_RESULT_LABELS = [
  '新线索',
  '非常有意向',
  '意向了解加微',
  '未接',
  '空号',
  '高分段',
  '无意向',
  '孩子不想读',
  '已报名',
];

export const FIXED_INVALID_REASON_LABELS = ['空号', '高分段', '无意向', '孩子不想读'];

export const RESULT_DETAIL_LABELS = [
  '非常有意向',
  '意向了解加微',
  ...FIXED_INVALID_REASON_LABELS,
];

export const RESULT_TO_DISPLAY_STATUS = {
  新线索: '未联系',
  非常有意向: '已联系',
  意向了解加微: '待回访',
  空号: '无效',
  高分段: '无效',
  无意向: '无效',
  孩子不想读: '无效',
};

export function isFixedInvalidReason(label) {
  return FIXED_INVALID_REASON_LABELS.includes(label);
}

export function displayStatusForOperatorResult(label) {
  return RESULT_TO_DISPLAY_STATUS[label] || label;
}

export function detailForOperatorResult(label) {
  return RESULT_DETAIL_LABELS.includes(label) ? label : '';
}

export function resolveOperatorResult(input) {
  const rawStatus = typeof input === 'string' ? input : input.status;
  const explicitInvalidReason = typeof input === 'object' ? input.invalid_reason : undefined;
  if (isFixedInvalidReason(rawStatus)) {
    return {
      status: '无效',
      invalidReason: rawStatus,
      originalStatus: rawStatus,
      fixedInvalid: true,
    };
  }
  if (explicitInvalidReason) {
    return {
      status: rawStatus,
      invalidReason: explicitInvalidReason,
      originalStatus: rawStatus,
      fixedInvalid: false,
    };
  }
  return {
    status: rawStatus,
    invalidReason: undefined,
    originalStatus: rawStatus,
    fixedInvalid: false,
  };
}

export function payloadForOperatorResult(label) {
  const result = resolveOperatorResult(label);
  return result.invalidReason
    ? { status: result.status, invalid_reason: result.invalidReason }
    : { status: result.status };
}
