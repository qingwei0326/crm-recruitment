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
                completed_dial_sessions: 1,
                pending_dial_sessions: 0,
                legacy_missing_duration: 0,
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
                  recording_state: 'completed',
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
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('待完成')).toBeInTheDocument();
    expect(screen.getByText('历史未回填')).toBeInTheDocument();
    expect(screen.getAllByText('拨号流程耗时').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('操作内容')).not.toBeInTheDocument();
    expect(screen.queryByText('备注内容')).not.toBeInTheDocument();
  });

  it('labels pending and legacy rows separately', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/admin/agents') {
        return Promise.resolve({ data: { data: agents } });
      }
      if (url === '/operation-logs/call-volume') {
        return Promise.resolve({
          data: {
            data: {
              total: 2,
              summary: {
                total_calls: 2,
                recorded_calls: 0,
                unrecorded_calls: 2,
                completed_dial_sessions: 0,
                pending_dial_sessions: 1,
                legacy_missing_duration: 1,
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
                  recording_state: 'pending',
                  dialed_at: '2026-06-27 01:52:20',
                },
                {
                  seq: 2,
                  agent_name: '蒲安琪',
                  student_id: 43404,
                  student_name: '历史学生',
                  duration_seconds: 0,
                  recording_state: 'legacy_missing',
                  dialed_at: '2026-06-26 01:52:20',
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
    expect(screen.getAllByText('待完成').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('历史未回填').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('平均流程耗时')).toBeInTheDocument();
    expect(screen.queryByText('未记录')).not.toBeInTheDocument();
  });
});
