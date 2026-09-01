import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import useSyncManager from '../useSyncManager';
import api from '../../api';

const pendingOps = [
  { id: 1, type: 'add_note', payload: { studentId: 10, content: '备注' } },
  {
    id: 2,
    type: 'add_call',
    payload: { studentId: 10, duration: 90 },
  },
];
const markSynced = vi.fn();

vi.mock('../../api', () => ({
  default: {
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../useOfflineStorage', () => ({
  default: () => ({
    getPendingSync: vi.fn().mockResolvedValue(pendingOps),
    markSynced,
    clearCache: vi.fn(),
  }),
}));

vi.mock('../useOnlineStatus', () => ({
  default: () => ({ isOnline: true }),
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

function SyncHarness() {
  useSyncManager();
  return null;
}

describe('useSyncManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('syncs notes and ignores legacy AI call operations', async () => {
    render(<SyncHarness />);

    await waitFor(() => expect(markSynced).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledWith('/notes', {
      student_id: 10,
      content: '备注',
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalledWith('/calls/analyze', expect.anything());
  });
});
