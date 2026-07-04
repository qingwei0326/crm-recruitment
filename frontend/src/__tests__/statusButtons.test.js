import { describe, expect, it } from 'vitest';
import { DESKTOP_DIAL_STATUS_BUTTONS } from '../labels';
import { STATUS_BUTTONS as MOBILE_DIAL_STATUS_BUTTONS } from '../components/MobileDialResult';
import { OPERATOR_RESULT_LABELS } from '../operatorResultPolicy';
import { getContactOptions, QUICK_STATUSES } from '../pages/agent/agentWorkUtils';

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

  it('deduplicates identical contact phone options', () => {
    expect(
      getContactOptions({
        guardian_name: '联系人甲',
        guardian_phone: '13800138000',
        guardian2_name: '联系人乙',
        guardian2_phone: '138 0013 8000',
      }),
    ).toEqual([
      {
        key: 'guardian',
        label: '联系人1',
        name: '联系人甲',
        phone: '13800138000',
      },
    ]);
  });
});
