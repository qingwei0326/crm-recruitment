import { describe, expect, it } from 'vitest';
import {
  displayStatusForOperatorResult,
  isFixedInvalidReason,
  payloadForOperatorResult,
  resolveOperatorResult,
} from '../operatorResultPolicy';

describe('operatorResultPolicy', () => {
  it('maps fixed invalid result labels to invalid status and reason', () => {
    expect(resolveOperatorResult('空号')).toEqual({
      status: '无效',
      invalidReason: '空号',
      originalStatus: '空号',
      fixedInvalid: true,
    });
    expect(payloadForOperatorResult('无意向')).toEqual({
      status: '无效',
      invalid_reason: '无意向',
    });
  });

  it('keeps normal result labels as workflow statuses', () => {
    expect(isFixedInvalidReason('已联系')).toBe(false);
    expect(displayStatusForOperatorResult('意向了解加微')).toBe('待回访');
    expect(payloadForOperatorResult('未接')).toEqual({ status: '未接' });
  });
});
