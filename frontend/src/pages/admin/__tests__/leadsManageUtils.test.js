import { describe, expect, it } from 'vitest';
import { STATUS_DETAIL_OPTS } from '../leadsManageUtils';

describe('admin lead result filters', () => {
  it('allows administrators to query students waiting for volunteer choices', () => {
    expect(STATUS_DETAIL_OPTS).toContain('等待志愿');
  });
});
