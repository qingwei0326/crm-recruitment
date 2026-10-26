import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VisitReportForm from '../VisitReportForm';
import { toggleProgram } from '../programs';

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

describe('VisitReportForm', () => {
  it('needs a home or campus visit time before it can be submitted', () => {
    const onSubmit = vi.fn();
    render(<VisitReportForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: '只提交' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '提交并复制到群' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('家访时间'), { target: { value: '明天再约' } });
    expect(screen.getByRole('button', { name: '只提交' })).toBeEnabled();
  });

  it('files both visits from one report and copies it in the group layout', async () => {
    const onSubmit = vi.fn();
    render(<VisitReportForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '无人机' }));
    fireEvent.click(screen.getByRole('button', { name: '计算机' }));
    fireEvent.change(screen.getByLabelText('中考分数'), { target: { value: '200-300分' } });
    fireEvent.change(screen.getByLabelText('到校参观时间（具体时间）'), {
      target: { value: '2026-07-16T10:00' },
    });
    fireEvent.change(screen.getByLabelText('家访时间'), {
      target: { value: '晚上有空，具体哪天明天确认' },
    });
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: '长泰区陈巷镇' } });
    fireEvent.change(screen.getByLabelText('情况'), { target: { value: '家长下班才有空' } });
    fireEvent.click(screen.getByRole('button', { name: '提交并复制到群' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: 42,
        intent_program: '无人机、计算机',
        exam_score_text: '200-300分',
        campus_visit_at: '2026-07-16T10:00:00',
        campus_visit_note: '',
        home_visit_at: null,
        home_visit_note: '晚上有空，具体哪天明天确认',
        address: '长泰区陈巷镇',
        situation: '家长下班才有空',
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      [
        '话务员：小李',
        '学生姓名：张三',
        '家长电话：13800000000',
        '意向专业：无人机、计算机',
        '中考分数：200-300分',
        '到校参观时间：7月16日 10:00',
        '情况：家长下班才有空',
        '家访时间：晚上有空，具体哪天明天确认',
        '地址：长泰区陈巷镇',
      ].join('\n'),
    );
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith('已复制，可以直接粘贴到群里'));
  });

  it('submits without copying from the plain submit button', () => {
    const onSubmit = vi.fn();
    render(<VisitReportForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('到校参观时间'), { target: { value: '成绩出来后' } });
    fireEvent.click(screen.getByRole('button', { name: '只提交' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ campus_visit_note: '成绩出来后', home_visit_note: '' }),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('keeps the optional fields folded away until asked for', () => {
    render(<VisitReportForm student={student} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByLabelText('平时成绩')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /更多/ }));
    expect(screen.getByLabelText('平时成绩')).toBeInTheDocument();
  });

  it('leaves a masked phone number blank instead of copying it', () => {
    render(
      <VisitReportForm
        student={{ ...student, guardian_phone: '138****0000' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('家长电话')).toHaveValue('');
  });
});

describe('toggleProgram', () => {
  it('adds a tapped major and removes it on a second tap', () => {
    expect(toggleProgram('', '无人机')).toBe('无人机');
    expect(toggleProgram('无人机', '机电')).toBe('无人机、机电');
    expect(toggleProgram('无人机、机电', '无人机')).toBe('机电');
    expect(toggleProgram('电商, 无人机', '机电')).toBe('电商、无人机、机电');
  });
});
