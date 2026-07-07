import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AssignmentBatchReview from '../AssignmentBatchReview';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: 'admin',
      name: '测试管理员',
      is_super_admin: true,
      must_change_password: false,
    },
    logout: vi.fn(),
  }),
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

const reviewPayload = {
  batch: {
    batch_id: 'smart-assign-review-test',
    action: '智能分配汇总',
    operator_name: '测试管理员',
    assigned_at: '2026-07-07 07:00:00',
    assigned_count: 4,
    window_days: 7,
    window_start: '2026-07-07 07:00:00',
    window_end: '2026-07-14 07:00:00',
    incomplete_assignment_trace: false,
  },
  funnel: {
    assigned: 4,
    dialed: 2,
    effective_handled: 2,
    enrolled: 1,
    undialed: 2,
    unhandled: 2,
    dial_rate: 50,
    effective_handle_rate: 50,
    enrollment_rate: 25,
  },
  agents: [
    {
      agent_id: 1,
      agent_name: '坐席A',
      assigned: 2,
      dialed: 1,
      effective_handled: 1,
      enrolled: 0,
      undialed: 1,
      unhandled: 1,
      dial_rate: 50,
      effective_handle_rate: 50,
      enrollment_rate: 0,
    },
  ],
  unhandled_students: [
    {
      student_id: 101,
      student_name: '未处理学生',
      school_name: '测试中学',
      region: '芗城区',
      agent_id: 1,
      agent_name: '坐席A',
      status: '未联系',
      dialed: false,
      effective_handled: false,
    },
  ],
  alerts: [
    {
      type: 'undialed_rate',
      severity: 'high',
      title: '未拨打比例偏高',
      detail: '窗口内 2 条线索仍未拨打。',
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/admin/assignment-batches/smart-assign-review-test/review']}
    >
      <Routes>
        <Route
          path="/admin/assignment-batches/:batchId/review"
          element={<AssignmentBatchReview />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssignmentBatchReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { code: 0, data: reviewPayload } });
  });

  it('loads and renders batch funnel, agents, unhandled students, and alerts', async () => {
    renderPage();

    expect(await screen.findByText('分配批次复盘')).toBeInTheDocument();
    expect(screen.getByText('smart-assign-review-test')).toBeInTheDocument();
    expect(screen.getByText('智能分配汇总')).toBeInTheDocument();
    expect(screen.getAllByText('已分配').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已拨打').length).toBeGreaterThan(0);
    expect(screen.getAllByText('有效处理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已报名').length).toBeGreaterThan(0);
    expect(screen.getAllByText('坐席A').length).toBeGreaterThan(0);
    expect(screen.getByText('未处理学生')).toBeInTheDocument();
    expect(screen.getByText('未拨打比例偏高')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      '/admin/assignment-batches/smart-assign-review-test/review',
      { params: { window_days: 7 } },
    );
  });

  it('reloads when switching window days', async () => {
    renderPage();

    expect(await screen.findByText('分配批次复盘')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3天' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith(
        '/admin/assignment-batches/smart-assign-review-test/review',
        { params: { window_days: 3 } },
      );
    });
  });

  it('shows missing batch state from API code 1', async () => {
    api.get.mockResolvedValue({ data: { code: 1, msg: '未找到该分配批次' } });

    renderPage();

    expect(await screen.findByText('未找到该分配批次')).toBeInTheDocument();
  });
});
