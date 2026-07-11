import { describe, expect, it, vi } from 'vitest';
import {
  createIdempotencyKey,
  normalizeHandoverBatch,
  normalizeHandoverDetail,
  normalizeTransferResult,
} from '../handover';

describe('handover contract adapters', () => {
  it('normalizes a handover batch to the stable frontend shape', () => {
    expect(
      normalizeHandoverBatch({
        id: 12,
        source_agent: { id: 7, name: '原话务员' },
        status: 'pending',
        version: 3,
        total_items: 9,
        remaining_items: 4,
        transferred_items: 5,
        initiated_at: '2026-07-11 01:00:00',
      }),
    ).toEqual({
      id: 12,
      sourceAgent: { id: 7, name: '原话务员' },
      status: 'pending',
      version: 3,
      total: 9,
      remaining: 4,
      transferred: 5,
      initiatedAt: '2026-07-11 01:00:00',
    });
  });

  it('uses safe defaults for malformed numeric values and missing lists', () => {
    const detail = normalizeHandoverDetail({
      batch: { id: 'bad', total_items: -2, remaining_items: null },
      total: 'bad',
      items: null,
      filter_options: null,
    });

    expect(detail.batch.id).toBe(0);
    expect(detail.batch.total).toBe(0);
    expect(detail.total).toBe(0);
    expect(detail.items).toEqual([]);
    expect(detail.filterOptions).toEqual({ regions: [], schools: [], intents: [], kinds: [] });
  });

  it('normalizes transfer execution arrays and counters', () => {
    expect(
      normalizeTransferResult({
        transfer_id: 4,
        transferred_ids: [2, 1],
        skipped_ids: null,
        remaining_count: 6,
        batch_version: 3,
        completed: false,
      }),
    ).toEqual({
      transferId: 4,
      transferredIds: [2, 1],
      skippedIds: [],
      remainingCount: 6,
      batchVersion: 3,
      completed: false,
    });
  });

  it('creates namespaced idempotency keys with UUID support', () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('abc-123');

    expect(createIdempotencyKey(12)).toBe('handover-12-abc-123');
    expect(createIdempotencyKey(12)).toMatch(/^handover-[0-9]+-[0-9a-f-]+$/);

    randomUUID.mockRestore();
  });
});
