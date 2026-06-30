import { describe, expect, it } from 'vitest';
import { DESKTOP_DIAL_STATUS_BUTTONS } from '../labels';
import { STATUS_BUTTONS as MOBILE_DIAL_STATUS_BUTTONS } from '../components/MobileDialResult';
import { OPERATOR_RESULT_LABELS } from '../operatorResultPolicy';
import { QUICK_STATUSES } from '../pages/agent/agentWorkUtils';

describe('operator status buttons', () => {
  it('keeps desktop dial result buttons aligned with the required workflow', () => {
    expect(DESKTOP_DIAL_STATUS_BUTTONS.map((button) => button.status)).toEqual(OPERATOR_RESULT_LABELS);
  });

  it('keeps desktop quick status buttons aligned with the required workflow', () => {
    expect(QUICK_STATUSES.map((button) => button.status)).toEqual(OPERATOR_RESULT_LABELS);
  });

  it('keeps mobile dial result buttons aligned with the required workflow', () => {
    expect(MOBILE_DIAL_STATUS_BUTTONS.map((button) => button.label)).toEqual(OPERATOR_RESULT_LABELS);
  });
});
