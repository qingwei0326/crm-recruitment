import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MobileStudentDetail from '../MobileStudentDetail';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, role: 'agent', name: '话务员' },
  }),
}));

const { mockConfirm } = vi.hoisted(() => ({ mockConfirm: vi.fn() }));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../../../hooks/useDialFlow', () => ({
  default: () => ({
    dial: vi.fn(),
  }),
}));

vi.mock('../../../components/MobileDialResult', () => ({
  default: () => null,
}));

const detailPayload = {
  student: {
    id: 42,
    name: '张三',
    status: '未联系',
    stage: '初次联系',
    intent_level: '无',
    agent_id: 7,
    region: '海淀',
    school_name: '一中',
    guardian_name: '家长',
    guardian_phone: '138****0000',
  },
  calls: [],
  notes: [],
  follow_ups: [
    {
      id: 501,
      student_id: 42,
      follow_up_date: '2026-06-11T10:00:00',
      is_completed: false,
      agent_id: 7,
      agent_name: '话务员',
      created_at: '2026-06-10T09:00:00',
    },
  ],
  visits: [
    {
      id: 601,
      student_id: 42,
      visit_type: '来校参观',
      scheduled_date: '2026-06-12T10:00:00',
      status: '待确认',
      agent_id: 7,
      agent_name: '话务员',
      created_at: '2026-06-10T09:30:00',
    },
  ],
};

const serverReasons = [
  { code: 'phone_invalid', label: '空号', terminal: true, reclaimable: true },
  { code: 'high_score', label: '高分段', terminal: true, reclaimable: true },
  { code: 'no_intent', label: '无意向', terminal: true, reclaimable: true },
  { code: 'child_declined', label: '孩子不想读', terminal: true, reclaimable: true },
  { code: 'enrolled_elsewhere', label: '已报名其他学校', terminal: true, reclaimable: false },
  { code: 'other', label: '其他', terminal: true, reclaimable: true },
];

function mockDetailLoads() {
  api.get.mockImplementation((url) => {
    if (url === '/students/42/detail') {
      return Promise.resolve({ data: { code: 0, data: detailPayload } });
    }
    if (url === '/lead-outcome-reasons') {
      return Promise.resolve({ data: { code: 0, data: serverReasons } });
    }
    return Promise.resolve({ data: { code: 0, data: {} } });
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/mobile/student/42']}>
        <Routes>
          <Route path="/mobile/student/:id" element={<MobileStudentDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MobileStudentDetail follow-up workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockConfirm.mockResolvedValue(true);
    mockDetailLoads();
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
    api.delete.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('lets agents update status and stage from the mobile detail page', async () => {
    sessionStorage.setItem('pendingDial', JSON.stringify({
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 20_000,
    }));
    renderPage();

    await screen.findByText('完整时间线');
    fireEvent.click(screen.getByRole('button', { name: '编辑状态' }));
    const editor = screen.getByRole('dialog', { name: '编辑跟进状态' });

    fireEvent.click(within(editor).getByRole('button', { name: '非常有意向' }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', { status: '非常有意向' });
    });
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
        params: {
          student_id: 42,
          dial_log_id: 9001,
          duration_seconds: expect.any(Number),
        },
      });
    });

    fireEvent.click(within(editor).getByRole('tab', { name: '跟进阶段' }));
    fireEvent.click(within(editor).getByRole('button', { name: '意向跟进' }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42/stage', { stage: '有意向' });
    });

  });

  it('does not show intent level controls on the mobile detail page', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    expect(screen.queryByText('意向等级')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '编辑状态' }));
    const editor = screen.getByRole('dialog', { name: '编辑跟进状态' });
    expect(within(editor).queryByRole('tab', { name: '意向等级' })).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'A 级' })).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'B 级' })).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'C 级' })).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: '初次联系' })).not.toBeInTheDocument();
  });

  it('keeps dial as the primary bottom action and groups secondary actions', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    expect(screen.getByRole('button', { name: '开始拨打' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const moreActions = screen.getByRole('dialog', { name: '学生更多操作' });
    expect(within(moreActions).getByRole('button', { name: '写备注' })).toBeInTheDocument();
    expect(within(moreActions).getByRole('button', { name: '登记到访' })).toBeInTheDocument();
    expect(within(moreActions).getByRole('button', { name: '编辑状态' })).toBeInTheDocument();
  });

  it('shows the required operator result buttons on the mobile detail page', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    expect(screen.queryByRole('group', { name: '处理结果' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑状态' }));
    const resultButtons = within(screen.getByRole('dialog', { name: '编辑跟进状态' }))
      .getByRole('group', { name: '处理结果' });

    [
      '非常有意向',
      '意向了解加微',
      '等待志愿',
      '未接',
      '空号',
      '高分段',
      '无意向',
      '孩子不想读',
      '已报名其他学校',
    ].forEach((label) => {
      expect(within(resultButtons).getByRole('button', { name: label })).toBeInTheDocument();
    });
    expect(within(resultButtons).queryByRole('button', { name: '新线索' })).not.toBeInTheDocument();
  });

  it('saves fixed invalid results with invalid reason from the mobile detail page', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    fireEvent.click(screen.getByRole('button', { name: '编辑状态' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑跟进状态' })).getByRole('button', { name: '空号' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', {
        status: '无效',
        invalid_reason: '空号',
      });
    });
  });

  it('saves enrolled elsewhere as a non-reclaimable invalid result', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    fireEvent.click(screen.getByRole('button', { name: '编辑状态' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑跟进状态' })).getByRole('button', { name: '已报名其他学校' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', {
        status: '无效',
        invalid_reason: '已报名其他学校',
      });
    });
  });

  it('keeps the pending session when direct status save succeeds but duration sync fails', async () => {
    sessionStorage.setItem('pendingDial', JSON.stringify({
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 20_000,
    }));
    api.put.mockImplementation((url) => {
      if (url === '/students/dial-duration') return Promise.reject(new Error('network failed'));
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
    renderPage();

    await screen.findByText('完整时间线');
    fireEvent.click(screen.getByRole('button', { name: '编辑状态' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑跟进状态' })).getByRole('button', { name: '空号' }));

    expect(await screen.findByText('状态已保存，通话记录待同步')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('pendingDial'))).toEqual(
      expect.objectContaining({ dialLogId: 9001 }),
    );
  });

  it('lets agents complete and reschedule follow-ups from the timeline', async () => {
    renderPage();

    const followUp = await screen.findByTestId('follow-up-501');
    fireEvent.click(within(followUp).getByRole('button', { name: '完成回访' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/follow-ups/501', { is_completed: true });
    });

    fireEvent.click(within(followUp).getByRole('button', { name: '改期' }));
    fireEvent.change(screen.getByLabelText('回访时间'), {
      target: { value: '2026-06-13T15:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存回访' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/follow-ups/501', {
        follow_up_date: '2026-06-13T15:30:00',
      });
    });
  });

  it('lets agents update visit status and schedule from the timeline', async () => {
    renderPage();

    const visit = await screen.findByTestId('visit-601');
    fireEvent.click(within(visit).getByRole('button', { name: '已确认' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/visits/601', { status: '已确认' });
    });

    fireEvent.click(within(visit).getByRole('button', { name: '改期' }));
    fireEvent.change(screen.getByLabelText('到访时间'), {
      target: { value: '2026-06-14T09:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到访' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/visits/601', {
        scheduled_date: '2026-06-14T09:00:00',
      });
    });
  });

  it('deletes a follow-up and a visit only after the in-app confirm is accepted', async () => {
    renderPage();

    const followUp = await screen.findByTestId('follow-up-501');
    fireEvent.click(within(followUp).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/follow-ups/501'));

    fireEvent.click(within(screen.getByTestId('visit-601')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/visits/601'));

    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
  });

  it('does not delete a follow-up or visit when the confirm is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    renderPage();

    fireEvent.click(within(await screen.findByTestId('follow-up-501')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByTestId('visit-601')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(2));

    expect(api.delete).not.toHaveBeenCalled();
  });
});
