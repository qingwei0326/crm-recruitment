import { describe, expect, it } from 'vitest';
import {
  FALLBACK_OPERATOR_OUTCOMES,
  getOperatorOutcomeGroups,
  isOutcomeReclaimable,
  outcomeCatalogByCode,
  resolveOutcomeCatalog,
} from '../outcomeCatalog';

describe('outcome catalog', () => {
  it('contains the non-reclaimable enrolled-elsewhere result offline', () => {
    const item = FALLBACK_OPERATOR_OUTCOMES.find((outcome) => outcome.code === 'enrolled_elsewhere');
    expect(item).toMatchObject({
      label: '已报名其他学校',
      status: '无效',
      invalidReason: '已报名其他学校',
      terminal: true,
      reclaimable: false,
    });
  });

  it('uses active server reason ordering and rules while retaining workflow results', () => {
    const catalog = resolveOutcomeCatalog([
      { code: 'enrolled_elsewhere', label: '已报名其他学校', terminal: true, reclaimable: false },
      { code: 'phone_invalid', label: '空号', terminal: true, reclaimable: true },
    ]);
    const operatorResults = catalog.filter(
      (item) => item.operatorVisible && item.agentVisible !== false,
    );

    expect(operatorResults.map((item) => item.code)).toEqual([
      'new_lead',
      'very_interested',
      'interested_wechat',
      'waiting_volunteer',
      'missed_call',
      'enrolled_elsewhere',
      'phone_invalid',
    ]);
    expect(isOutcomeReclaimable(
      { outcome_reason_code: 'enrolled_elsewhere' },
      outcomeCatalogByCode(catalog),
    )).toBe(false);
  });

  it('keeps the connected-call groups derived from the same catalog', () => {
    const groups = getOperatorOutcomeGroups(FALLBACK_OPERATOR_OUTCOMES);

    expect(groups.connectedFollowUp.map((item) => item.code)).toEqual([
      'very_interested',
      'interested_wechat',
      'waiting_volunteer',
    ]);
    expect(groups.connectedConclusion.map((item) => item.code)).toEqual([
      'high_score',
      'no_intent',
      'child_declined',
      'enrolled_elsewhere',
    ]);
    expect(groups.moreResults.map((item) => item.code)).toEqual([]);
    expect(groups.phoneInvalid?.code).toBe('phone_invalid');
  });
});
