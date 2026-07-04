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
      hasAnalysis={false}
      {...props}
    />,
  );
}

describe('StudentDetailDrawer admissions actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: { code: 0, data: { id: 99 } } });
  });

  it('submits a home visit request from the detail drawer', async () => {
    const onStageSynced = vi.fn();
    renderDrawer({ onStageSynced });

    fireEvent.click(screen.getByRole('button', { name: '申请家访' }));
    fireEvent.change(screen.getByLabelText('家访地址'), {
      target: { value: '芗城区测试路 1 号' },
    });
    fireEvent.change(screen.getByLabelText('家访备注'), {
      target: { value: '家长同意上门沟通' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交家访申请' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/home-visits', {
        student_id: 42,
        intent_program: '护理',
        exam_score: 520,
        usual_score: null,
        parent_intent: '',
        student_situation: '',
        is_wechat_added: false,
        is_confirmed_with_guardian: false,
        requested_visit_time: null,
        address: '芗城区测试路 1 号',
        priority: '中',
        notes: '家长同意上门沟通',
      });
    });
    expect(onStageSynced).toHaveBeenCalledWith(42, '待家访');
  });

  it('includes campus visit timing and situation in the home visit report notes', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: '申请家访' }));
    expect(screen.getByText('上报信息')).toBeInTheDocument();
    expect(screen.getByText('家访安排')).toBeInTheDocument();
    expect(screen.getByText('沟通情况')).toBeInTheDocument();
    expect(screen.getByText('学生姓名：林宇涛')).toBeInTheDocument();
    expect(screen.getByText('家长电话：13800138000')).toBeInTheDocument();
    expect(screen.getByText('意向专业：护理')).toBeInTheDocument();
    expect(screen.getByText('中考分数：520')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('到校参观时间'), {
      target: { value: '周六上午' },
    });
    fireEvent.change(screen.getByLabelText('情况'), {
      target: { value: '家长愿意先家访再到校' },
    });
    fireEvent.change(screen.getByLabelText('家访备注'), {
      target: { value: '需要管理员尽快安排' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交家访申请' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/home-visits', expect.objectContaining({
        notes: '到校参观时间：周六上午\n情况：家长愿意先家访再到校\n需要管理员尽快安排',
      }));
    });
  });

  it('submits a campus visit appointment from the detail drawer', async () => {
    const onStageSynced = vi.fn();
    renderDrawer({ onStageSynced });

    fireEvent.click(screen.getByRole('button', { name: '预约到校' }));
    fireEvent.change(screen.getByLabelText('预约到校时间'), {
      target: { value: '2026-07-04T09:30' },
    });
    fireEvent.change(screen.getByLabelText('来校人数'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交到校预约' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/campus-visits', {
        student_id: 42,
        source: '电话外呼',
        intent_program: '护理',
        appointment_at: '2026-07-04T09:30:00',
        needs_pickup: false,
        visitor_count: 3,
        current_concerns: '',
        notes: '',
      });
    });
    expect(onStageSynced).toHaveBeenCalledWith(42, '到校参观已安排');
  });
});
