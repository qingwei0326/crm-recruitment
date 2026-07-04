import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CallVolumeQuery from '../CallVolumeQuery';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: 'admin',
      is_super_admin: true,
      operation_permissions: '',
    },
  }),
}));

const agents = [{ id: 7, name: '蒲安琪' }];

describe('CallVolumeQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === '/admin/agents') {
        return Promise.resolve({ data: { data: agents } });
      }
      if (url === '/operation-logs/call-volume') {
        return Promise.resolve({
          data: {
            data: {
              total: 1,
              summary: {
                total_calls: 1,
                recorded_calls: 1,
                unrecorded_calls: 0,
                total_recorded_duration_seconds: 73,
                avg_recorded_duration_seconds: 73,
              },
              list: [
                {
                  seq: 1,
                  agent_name: '蒲安琪',
                  operator_name: '蒲安琪',
                  student_id: 43402,
                  student_name: '刘子威',
                  duration_seconds: 73,
                  dialed_at: '2026-06-27 01:52:20',
                },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  });

  it('renders real dial records instead of operation-log columns', async () => {
    render(<CallVolumeQuery embedded />);

    expect(await screen.findByText('刘子威')).toBeInTheDocument();
    expect(screen.getAllByText('蒲安琪').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('43402')).toBeInTheDocument();
    expect(screen.getAllByText('1分13秒').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2026-06-27 09:52:20')).toBeInTheDocument();
    expect(screen.getByText('总拨号')).toBeInTheDocument();
    expect(screen.getByText('有效记录')).toBeInTheDocument();
    expect(screen.getByText('未记录')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('操作内容')).not.toBeInTheDocument();
    expect(screen.queryByText('备注内容')).not.toBeInTheDocument();
  });

  it('labels zero duration as not recorded', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/admin/agents') {
        return Promise.resolve({ data: { data: agents } });
      }
      if (url === '/operation-logs/call-volume') {
        return Promise.resolve({
          data: {
            data: {
              total: 1,
              summary: {
                total_calls: 1,
                recorded_calls: 0,
                unrecorded_calls: 1,
                total_recorded_duration_seconds: 0,
                avg_recorded_duration_seconds: 0,
              },
              list: [
                {
                  seq: 1,
                  agent_name: '蒲安琪',
                  student_id: 43403,
                  student_name: '未补时长学生',
                  duration_seconds: 0,
                  dialed_at: '2026-06-27 01:52:20',
                },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    render(<CallVolumeQuery embedded />);

    expect(await screen.findByText('未补时长学生')).toBeInTheDocument();
    expect(screen.getAllByText('未记录').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('平均有效时长')).toBeInTheDocument();
  });
});
