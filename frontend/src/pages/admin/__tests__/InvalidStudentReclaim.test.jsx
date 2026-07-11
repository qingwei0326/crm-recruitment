import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InvalidStudentReclaim from '../InvalidStudentReclaim';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员', is_super_admin: true },
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

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const highScoreStudents = [
  {
    id: 10,
    name: '高分段学生',
    region: '龙海',
    guardian_name: '家长甲',
    guardian_phone: '8001',
    guardian2_name: '家长乙',
    guardian2_phone: '13960043037',
    agent_name: '王坐席',
    invalid_reason: '高分段',
    outcome_reason_code: 'high_score',
    invalid_operator_name: '王坐席',
    invalid_at: '2026-06-26T09:00:00',
    updated_at: '2026-06-26T10:00:00',
  },
  {
    id: 11,
    name: '已报他校学生',
    region: '龙海',
    guardian_name: '家长丙',
    guardian_phone: '8002',
    agent_name: '王坐席',
    invalid_reason: '已报名其他学校',
    outcome_reason_code: 'enrolled_elsewhere',
    invalid_operator_name: '王坐席',
    invalid_at: '2026-06-26T09:00:00',
    updated_at: '2026-06-26T10:00:00',
  },
];

const serverReasons = [
  { code: 'phone_invalid', label: '空号', terminal: true, reclaimable: true },
  { code: 'high_score', label: '高分段', terminal: true, reclaimable: true },
  { code: 'no_intent', label: '无意向', terminal: true, reclaimable: true },
  { code: 'child_declined', label: '孩子不想读', terminal: true, reclaimable: true },
  { code: 'enrolled_elsewhere', label: '已报名其他学校', terminal: true, reclaimable: false },
  { code: 'other', label: '其他', terminal: true, reclaimable: true },
];

function mockInvalidApis() {
  api.get.mockImplementation((url, config = {}) => {
    if (url === '/lead-outcome-reasons') {
      return Promise.resolve({ data: { code: 0, data: serverReasons } });
    }
    if (url === '/admin/invalid-school-groups') {
      const reason = config.params?.invalid_reason || '';
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            groups:
              reason === '高分段'
                ? [{ name: '龙海一中', count: 1 }]
                : [
                    { name: '龙海一中', count: 1 },
                    { name: '漳州二中', count: 1 },
                  ],
          },
        },
      });
    }
    if (url === '/admin/invalid-students') {
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            list: highScoreStudents,
          },
        },
      });
    }
    return Promise.resolve({ data: { code: 0, data: {} } });
  });
  api.post.mockResolvedValue({ data: { code: 0, data: { reclaimed_count: 1, deleted_count: 1 } } });
}

function renderPage(entry = '/admin/invalid-reclaim') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[entry]}>
        <InvalidStudentReclaim />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InvalidStudentReclaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidApis();
  });

  it('filters invalid leads by reason and batch reclaims selected rows', async () => {
    renderPage();

    expect(await screen.findByText('龙海一中')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '高分段' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith('/admin/invalid-school-groups', {
        params: { invalid_reason: '高分段' },
      }),
    );

    fireEvent.click(await screen.findByText('龙海一中'));
    expect(await screen.findByText('高分段学生')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/invalid-students', {
      params: {
        page: 1,
        page_size: 200,
        school_name: '龙海一中',
        invalid_reason: '高分段',
      },
    });

    fireEvent.click(screen.getByLabelText('选择高分段学生'));
    fireEvent.click(screen.getByRole('button', { name: '回收到未分配池' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/invalid-students/reclaim', {
        student_ids: [10],
      }),
    );
  });

  it('deletes selected invalid leads after confirmation', async () => {
    renderPage();

    fireEvent.click(await screen.findByText('龙海一中'));
    expect(await screen.findByText('高分段学生')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('选择高分段学生'));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/invalid-students/delete', {
        student_ids: [10],
      }),
    );
  });

  it('passes url search query to invalid groups and expanded students', async () => {
    renderPage('/admin/invalid-reclaim?q=3037');

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/admin/invalid-school-groups', {
        params: { q: '3037' },
      }),
    );

    fireEvent.click(await screen.findByText('龙海一中'));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/admin/invalid-students', {
        params: {
          page: 1,
          page_size: 200,
          school_name: '龙海一中',
          q: '3037',
        },
      }),
    );
    expect(await screen.findByText(/13960043037/)).toBeInTheDocument();
  });

  it('prevents enrolled-elsewhere rows and filters from being reclaimed', async () => {
    renderPage();

    fireEvent.click(await screen.findByText('龙海一中'));
    const enrolledCheckbox = await screen.findByLabelText('选择已报他校学生');
    expect(enrolledCheckbox).toBeDisabled();
    expect(enrolledCheckbox).toHaveAttribute('title', '已报名其他学校为终态记录，不可回收');

    fireEvent.click(screen.getByLabelText('选择当前学校全部无效线索'));
    fireEvent.click(screen.getByRole('button', { name: '回收到未分配池' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admin/invalid-students/reclaim', {
        student_ids: [10],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '已报名其他学校' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '一键回收' })).not.toBeInTheDocument();
    });
  });
});
