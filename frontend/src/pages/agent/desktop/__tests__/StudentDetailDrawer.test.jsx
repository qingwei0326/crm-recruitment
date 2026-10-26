import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudentDetailDrawer from '../StudentDetailDrawer';
import api from '../../../../api';

vi.mock('../../../../api', () => ({
  default: {
    post: vi.fn(),
  },
}));

const student = {
  id: 42,
  name: '林宇涛',
  region: '芗城区',
  guardian_phone: '13800138000',
  school_name: '漳州一中',
  program: '护理',
  score: 520,
  intent_level: 'A',
};

function renderDrawer(extraProps = {}) {
  const props = {
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onUpdateField: vi.fn(),
    onDial: vi.fn(),
    onStageSynced: vi.fn(),
    onRefreshDetail: vi.fn(),
    ...extraProps,
  };
  return render(
    <StudentDetailDrawer
      open
      student={student}
      loading={false}
      error=""
      calls={[]}
      notes={[]}
      followUps={[]}
      visits={[]}
      intentTimeline={[]}
      admissionsTimeline={[]}
      {...props}
    />,
  );
}

describe('StudentDetailDrawer admissions actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: { code: 0, data: { id: 99 } } });
  });

  it('keeps the standard note action and omits AI analysis controls', () => {
    renderDrawer();

    expect(screen.queryByText('AI分析状态')).not.toBeInTheDocument();
    expect(screen.queryByText('AI分析')).not.toBeInTheDocument();
    expect(screen.getByText('完整时间线')).toBeInTheDocument();
  });

  it('files a home visit from the visit report in the detail drawer', async () => {
    const onStageSynced = vi.fn();
    api.post.mockResolvedValue({ data: { code: 0, data: { stage: '待家访' } } });
    renderDrawer({ onStageSynced });

    fireEvent.click(screen.getByRole('button', { name: '登记到访' }));
    expect(screen.getByText('学生姓名：林宇涛')).toBeInTheDocument();
    // Prefilled from the student record and still editable.
    expect(screen.getByLabelText('家长电话')).toHaveValue('13800138000');
    expect(screen.getByLabelText('意向专业')).toHaveValue('护理');
    expect(screen.getByLabelText('中考分数')).toHaveValue('520');

    fireEvent.change(screen.getByLabelText('家访时间'), { target: { value: '周六上午' } });
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: '芗城区测试路 1 号' } });
    fireEvent.change(screen.getByLabelText('情况'), { target: { value: '家长同意上门沟通' } });
    fireEvent.click(screen.getByRole('button', { name: '只提交' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/visit-reports', expect.objectContaining({
        student_id: 42,
        intent_program: '护理',
        exam_score_text: '520',
        home_visit_at: null,
        home_visit_note: '周六上午',
        campus_visit_at: null,
        campus_visit_note: '',
        address: '芗城区测试路 1 号',
        situation: '家长同意上门沟通',
      }));
    });
    expect(onStageSynced).toHaveBeenCalledWith(42, '待家访');
  });

  it('files a campus visit and follows the stage the server returns', async () => {
    const onStageSynced = vi.fn();
    api.post.mockResolvedValue({ data: { code: 0, data: { stage: '到校参观已安排' } } });
    renderDrawer({ onStageSynced });

    fireEvent.click(screen.getByRole('button', { name: '登记到访' }));
    fireEvent.change(screen.getByLabelText('到校参观时间（具体时间）'), {
      target: { value: '2026-07-04T09:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: /更多/ }));
    fireEvent.change(screen.getByLabelText('来校人数'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '只提交' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/visit-reports', expect.objectContaining({
        student_id: 42,
        campus_visit_at: '2026-07-04T09:30:00',
        home_visit_note: '',
        visitor_count: 3,
      }));
    });
    expect(onStageSynced).toHaveBeenCalledWith(42, '到校参观已安排');
  });
});
