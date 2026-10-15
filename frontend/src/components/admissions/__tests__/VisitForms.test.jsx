import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HomeVisitForm from '../HomeVisitForm';
import CampusVisitForm from '../CampusVisitForm';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '小李' } }),
}));

const toastSpy = { success: vi.fn(), error: vi.fn() };
vi.mock('../../Toast', () => ({
  useToast: () => toastSpy,
}));

const student = {
  id: 42,
  name: '张三',
  guardian_phone: '13800000000',
  program: '',
  score: null,
};

let writeText;

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('HomeVisitForm', () => {
  it('prefills the phone and lets the agent fill the program and score', () => {
    const onSubmit = vi.fn();
    render(<HomeVisitForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByLabelText('家长电话')).toHaveValue('13800000000');
    fireEvent.change(screen.getByLabelText('意向专业'), { target: { value: '无人机' } });
    fireEvent.change(screen.getByLabelText('中考分数'), { target: { value: '380' } });
    fireEvent.click(screen.getByRole('button', { name: '提交家访申请' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ student_id: 42, intent_program: '无人机', exam_score: 380 }),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('submits and copies the work-group report in one click', async () => {
    const onSubmit = vi.fn();
    render(<HomeVisitForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('意向专业'), { target: { value: '无人机' } });
    fireEvent.change(screen.getByLabelText('中考分数'), { target: { value: '380' } });
    fireEvent.change(screen.getByLabelText('家访地址'), { target: { value: '长泰区陈巷镇' } });
    fireEvent.change(screen.getByLabelText('期望家访时间'), { target: { value: '2026-07-14T15:30' } });
    fireEvent.change(screen.getByLabelText('情况'), { target: { value: '家长下班才有空' } });
    fireEvent.click(screen.getByRole('button', { name: '提交并复制报备' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      [
        '话务员：小李',
        '学生姓名：张三',
        '家长电话：13800000000',
        '意向专业：无人机',
        '中考分数：380',
        '到校参观时间：',
        '情况：家长下班才有空',
        '家访时间：7月14日 15:30',
        '地址：长泰区陈巷镇',
      ].join('\n'),
    );
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith('已复制，可以直接粘贴到群里'));
  });

  it('leaves a masked phone number blank instead of copying it', () => {
    render(
      <HomeVisitForm
        student={{ ...student, guardian_phone: '138****0000' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('家长电话')).toHaveValue('');
  });
});

describe('CampusVisitForm', () => {
  it('copies a report with the appointment as the campus visit time', async () => {
    const onSubmit = vi.fn();
    render(<CampusVisitForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('意向专业'), { target: { value: '电商' } });
    fireEvent.change(screen.getByLabelText('预约到校时间'), { target: { value: '2026-07-16T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '提交并复制报备' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ student_id: 42, intent_program: '电商' }),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('意向专业：电商');
    expect(copied).toContain('到校参观时间：7月16日 10:00');
    expect(copied).toContain('话务员：小李');
  });
});
