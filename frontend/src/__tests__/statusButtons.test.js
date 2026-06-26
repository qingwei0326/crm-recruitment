import { describe, expect, it } from 'vitest';
import { DESKTOP_DIAL_STATUS_BUTTONS } from '../labels';
import { STATUS_BUTTONS as MOBILE_DIAL_STATUS_BUTTONS } from '../components/MobileDialResult';
import { QUICK_STATUSES } from '../pages/agent/agentWorkUtils';

const EXPECTED_OPERATOR_BUTTONS = [
  '新线索',
  '非常有意向',
  '意向了解加微',
  '未接',
  '高分段',
  '无意向',
  '孩子不想读',
  '已报名',
];

describe('operator status buttons', () => {
  it('keeps desktop dial result buttons aligned with the required workflow', () => {
    expect(DESKTOP_DIAL_STATUS_BUTTONS.map((button) => button.status)).toEqual(EXPECTED_OPERATOR_BUTTONS);
  });

  it('keeps desktop quick status buttons aligned with the required workflow', () => {
    expect(QUICK_STATUSES.map((button) => button.status)).toEqual(EXPECTED_OPERATOR_BUTTONS);
  });

  it('keeps mobile dial result buttons aligned with the required workflow', () => {
    expect(MOBILE_DIAL_STATUS_BUTTONS.map((button) => button.label)).toEqual(EXPECTED_OPERATOR_BUTTONS);
  });
});
