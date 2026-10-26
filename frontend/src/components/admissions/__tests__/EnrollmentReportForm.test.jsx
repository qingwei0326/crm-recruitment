import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EnrollmentReportForm from '../EnrollmentReportForm';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '小李' } }),
}));

vi.mock('../../Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const student = { id: 42, name: '张三', region: '华安仙都', program: '' };

let writeText;

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('EnrollmentReportForm', () => {
  it('needs the enrolled major before it can be reported', () => {
    render(<EnrollmentReportForm student={student} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: '只上报' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '无人机' }));
    expect(screen.getByRole('button', { name: '只上报' })).toBeEnabled();
  });

  it('reports the enrollment and copies the 喜报 in the group layout', () => {
    const onSubmit = vi.fn();
    render(<EnrollmentReportForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByLabelText('地区')).toHaveValue('华安仙都');
    fireEvent.click(screen.getByRole('button', { name: '无人机' }));
    fireEvent.change(screen.getByLabelText('报名备注'), { target: { value: '已交定金' } });
    fireEvent.click(screen.getByRole('button', { name: '上报并复制喜报' }));

    expect(onSubmit).toHaveBeenCalledWith({
      student_id: 42,
      enrolled_program: '无人机',
      region: '华安仙都',
      notes: '已交定金',
    });
    expect(writeText).toHaveBeenCalledWith(
      [
        '[庆祝]喜 报[庆祝]',
        '学生姓名：张三',
        '报读专业：无人机',
        '话务员：小李',
        '地区：华安仙都',
        '再接再厉[烟花][烟花][烟花]',
      ].join('\n'),
    );
  });
});
