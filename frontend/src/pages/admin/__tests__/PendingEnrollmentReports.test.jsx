import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PendingEnrollmentReports from '../PendingEnrollmentReports';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const report = {
  id: 7,
  student_id: 42,
  student_name: '张三',
  school_name: '华安一中',
  region: '华安仙都',
  assigned_to: 3,
  reporter_name: '小李',
  enrolled_program: '无人机',
  notes: '已交定金',
  created_at: '2026-07-15 10:00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { code: 0, data: { list: [report] } } });
  api.post.mockResolvedValue({ data: { code: 0, data: {} } });
});

describe('PendingEnrollmentReports', () => {
  it('lists the reports waiting for an admin', async () => {
    render(<PendingEnrollmentReports />);

    expect(await screen.findByText('待确认报名 1 条')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('无人机')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admissions/enrollment-reports', {
      params: { status: '待确认' },
    });
  });

  it('confirms a report with the amounts the admin adds', async () => {
    const onConfirmed = vi.fn();
    render(<PendingEnrollmentReports onConfirmed={onConfirmed} />);

    fireEvent.click(await screen.findByRole('button', { name: '确认报名 张三' }));
    expect(screen.getByLabelText('报名专业')).toHaveValue('无人机');
    fireEvent.change(screen.getByLabelText('学生实付'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: '确认登记报名' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/enrollment-reports/7/confirm', {
        enrolled_program: '无人机',
        student_paid_amount: 500,
      });
    });
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('rejects a report with a reason', async () => {
    render(<PendingEnrollmentReports />);

    fireEvent.click(await screen.findByRole('button', { name: '驳回上报 张三' }));
    fireEvent.change(screen.getByLabelText('驳回原因 7'), { target: { value: '还没交钱' } });
    fireEvent.click(screen.getByRole('button', { name: '确定驳回' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/enrollment-reports/7/reject', {
        reason: '还没交钱',
      });
    });
  });

  it('shows nothing when no report is waiting', async () => {
    api.get.mockResolvedValue({ data: { code: 0, data: { list: [] } } });
    const { container } = render(<PendingEnrollmentReports />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
