import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

function mockDetailLoads() {
  api.get.mockImplementation((url) => {
    if (url === '/students/42/detail') {
      return Promise.resolve({ data: { code: 0, data: detailPayload } });
    }
    return Promise.resolve({ data: { code: 0, data: {} } });
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/mobile/student/42']}>
      <Routes>
        <Route path="/mobile/student/:id" element={<MobileStudentDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MobileStudentDetail follow-up workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockDetailLoads();
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
    api.delete.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('lets agents update status, stage, and intent directly from the mobile detail page', async () => {
    renderPage();

    await screen.findByText('完整时间线');

    fireEvent.click(screen.getByRole('button', { name: '非常有意向' }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', { status: '非常有意向' });
    });

    fireEvent.click(screen.getByRole('button', { name: '意向跟进' }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42/stage', { stage: '有意向' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'A 级' }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', { intent_level: 'A' });
    });
  });

  it('shows the required operator result buttons on the mobile detail page', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    const resultButtons = screen.getByRole('group', { name: '处理结果' });

    [
      '新线索',
      '非常有意向',
      '意向了解加微',
      '未接',
      '空号',
      '高分段',
      '无意向',
      '孩子不想读',
      '已报名',
    ].forEach((label) => {
      expect(within(resultButtons).getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('saves fixed invalid results with invalid reason from the mobile detail page', async () => {
    renderPage();

    await screen.findByText('完整时间线');
    fireEvent.click(screen.getByRole('button', { name: '空号' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', {
        status: '无效',
        invalid_reason: '空号',
      });
    });
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
});
