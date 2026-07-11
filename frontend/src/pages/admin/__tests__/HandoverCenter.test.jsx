import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HandoverCenter from '../HandoverCenter';

const mocks = vi.hoisted(() => ({
  useDetail: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  listRefetch: vi.fn(),
  detailRefetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const batches = [
  {
    id: 12,
    sourceAgent: { id: 7, name: '原员工甲' },
    status: 'pending',
    version: 3,
    total: 9,
    remaining: 4,
    transferred: 5,
    initiatedAt: '2026-07-11 01:00:00',
  },
  {
    id: 13,
    sourceAgent: { id: 9, name: '原员工乙' },
    status: 'completed',
    version: 2,
    total: 2,
    remaining: 0,
    transferred: 2,
    initiatedAt: '2026-07-10 01:00:00',
  },
];

const detail = {
  batch: batches[0],
  total: 2,
  page: 1,
  pageSize: 50,
  filterOptions: {
    regions: ['思明区'],
    schools: ['测试中学'],
    intents: ['A', 'B'],
    kinds: ['scheduled_follow_up'],
  },
  items: [
    {
      id: 1,
      studentId: 101,
      name: '合成学生甲',
      caseNo: 'E2E-101',
      schoolName: '测试中学',
      region: '思明区',
      status: '待回访',
      statusDetail: '明天联系',
      intentLevel: 'A',
      stage: '有意向',
      needHelp: true,
      handoverStatus: 'pending',
      targetAgentId: null,
      overdue: true,
      workItemKinds: ['scheduled_follow_up'],
      openWorkItemCount: 1,
    },
    {
      id: 2,
      studentId: 102,
      name: '合成学生乙',
      caseNo: 'E2E-102',
      schoolName: '测试中学',
      region: '思明区',
      status: '已联系',
      statusDetail: '',
      intentLevel: 'B',
      stage: '已送资料',
      needHelp: false,
      handoverStatus: 'pending',
      targetAgentId: null,
      overdue: false,
      workItemKinds: [],
      openWorkItemCount: 0,
    },
  ],
};

vi.mock('../../../hooks/useHandovers', () => ({
  useHandoverList: () => ({
    data: { total: 2, list: batches },
    isLoading: false,
    isError: false,
    refetch: mocks.listRefetch,
  }),
  useHandoverDetail: (...args) => mocks.useDetail(...args),
  useActiveHandoverAgents: () => ({
    data: [{ id: 8, name: '接手员工' }],
    isLoading: false,
  }),
  usePreviewHandoverTransfer: () => ({
    mutateAsync: mocks.preview,
    isPending: false,
  }),
  useExecuteHandoverTransfer: () => ({
    mutateAsync: mocks.execute,
    isPending: false,
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({ default: () => false }));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '测试管理员', is_super_admin: true },
    logout: vi.fn(),
  }),
}));
vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
}));
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(entry = '/admin/handovers?batch=12') {
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HandoverCenter />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function openSelectedPreview() {
  fireEvent.change(screen.getByLabelText('接手员工'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 合成学生甲' }));
  fireEvent.click(screen.getByRole('button', { name: '转派所选' }));
  await screen.findByRole('dialog');
}

describe('HandoverCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDetail.mockReturnValue({
      data: detail,
      isLoading: false,
      isError: false,
      refetch: mocks.detailRefetch,
    });
    mocks.listRefetch.mockResolvedValue({});
    mocks.detailRefetch.mockResolvedValue({});
    mocks.preview.mockResolvedValue({
      batchId: 12,
      version: 3,
      selectedCount: 1,
      openWorkItemCount: 1,
      overdueCount: 1,
      highIntentCount: 1,
      byKind: { scheduled_follow_up: 1 },
    });
    mocks.execute.mockResolvedValue({
      transferId: 50,
      transferredIds: [101],
      skippedIds: [],
      remainingCount: 3,
      batchVersion: 4,
      completed: false,
    });
  });

  it('renders batch progress and writes a selected batch to the URL', () => {
    renderPage();
    expect(screen.getByText('原员工甲')).toBeInTheDocument();
    expect(screen.getAllByText('剩余 4 / 9')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /原员工乙/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/handovers?batch=13&page=1');
  });

  it('keeps canonical filters in the URL and requests filtered detail', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('意向等级'), { target: { value: 'A' } });

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('batch=12&intent=A&page=1');
      expect(mocks.useDetail).toHaveBeenLastCalledWith(
        12,
        expect.objectContaining({ intent: 'A', page: 1, page_size: 50 }),
      );
    });
  });

  it('shows the domain lead-contact kind as a user-facing label', () => {
    mocks.useDetail.mockReturnValue({
      data: {
        ...detail,
        filterOptions: { ...detail.filterOptions, kinds: ['lead_contact'] },
        items: [
          { ...detail.items[0], workItemKinds: ['lead_contact'] },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.detailRefetch,
    });

    renderPage();

    expect(screen.getByRole('option', { name: '学生跟进' })).toBeInTheDocument();
    expect(screen.getByText('跟进')).toBeInTheDocument();
    expect(screen.queryByText('lead_contact')).not.toBeInTheDocument();
  });

  it('previews selected students and executes with the preview version', async () => {
    renderPage();
    await openSelectedPreview();

    expect(mocks.preview).toHaveBeenCalledWith({
      batchId: 12,
      mode: 'selected',
      studentIds: [101],
    });
    expect(within(screen.getByRole('dialog')).getByText('合成学生甲')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认交接' }));

    await waitFor(() => {
      expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
        batchId: 12,
        targetAgentId: 8,
        mode: 'selected',
        studentIds: [101],
        expectedVersion: 3,
        idempotencyKey: expect.stringMatching(/^handover-12-/),
      }));
    });
    expect(await screen.findByText(/交接完成 1 条/)).toBeInTheDocument();
  });

  it('refreshes and clears stale selection after a 409 conflict', async () => {
    mocks.execute.mockRejectedValue({ response: { status: 409, data: { msg: '版本冲突' } } });
    renderPage();
    await openSelectedPreview();
    fireEvent.click(screen.getByRole('button', { name: '确认交接' }));

    expect(await screen.findByText('交接数据已变化，请重新确认')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 合成学生甲' })).not.toBeChecked();
    expect(mocks.detailRefetch).toHaveBeenCalled();
    expect(mocks.listRefetch).toHaveBeenCalled();
  });

  it('retries an unknown network result with the same idempotency key', async () => {
    mocks.execute
      .mockRejectedValueOnce({ code: 'ERR_NETWORK', message: 'Network Error' })
      .mockResolvedValueOnce({
        transferId: 51,
        transferredIds: [101],
        skippedIds: [],
        remainingCount: 3,
        batchVersion: 4,
        completed: false,
      });
    renderPage();
    await openSelectedPreview();
    fireEvent.click(screen.getByRole('button', { name: '确认交接' }));

    const retry = await screen.findByRole('button', { name: '使用同一请求重试' });
    const firstRequest = mocks.execute.mock.calls[0][0];
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(mocks.execute.mock.calls[1][0]).toEqual(firstRequest);
  });
});
