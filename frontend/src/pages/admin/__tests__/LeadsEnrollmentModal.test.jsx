import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LeadsEnrollmentModal from '../leads/LeadsEnrollmentModal';

const toastSpy = { success: vi.fn(), error: vi.fn() };
vi.mock('../../../components/Toast', () => ({
  useToast: () => toastSpy,
}));

const baseForm = {
  enrolled_program: '无人机',
  amount: '',
  tuition_list_amount: '',
  student_subsidy_amount: '',
  student_paid_amount: '',
  external_subsidy_amount: '',
  commission_base_amount: '',
  commission_subsidy_amount: '',
  enrolled_at: '',
};

let writeText;

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

function renderModal(props = {}) {
  const onSubmit = vi.fn();
  render(
    <LeadsEnrollmentModal
      student={{ id: 42, name: '张三', region: '长泰', assigned_to: 7 }}
      form={baseForm}
      agentName="小李"
      submitting={false}
      onClose={vi.fn()}
      onFieldChange={vi.fn()}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

describe('LeadsEnrollmentModal', () => {
  it('registers the enrollment and copies the congratulation post in one click', async () => {
    const { onSubmit } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '登记并复制喜报' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      '[庆祝]喜 报[庆祝]\n学生姓名：张三\n报读专业：无人机\n话务员：小李\n地区：长泰\n再接再厉[烟花][烟花][烟花]',
    );
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith('喜报已复制，可以粘贴到群里'));
  });

  it('plain confirmation does not touch the clipboard', () => {
    const { onSubmit } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '确认登记报名' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('is disabled until the student has an owner', () => {
    renderModal({ student: { id: 42, name: '张三', region: '长泰', assigned_to: null } });
    expect(screen.getByRole('button', { name: '登记并复制喜报' })).toBeDisabled();
  });
});
