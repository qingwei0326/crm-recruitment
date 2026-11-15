import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AgentWorkDesktop from '../AgentWorkDesktop';
import api from '../../../api';

vi.mock('../../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../desktop/AgentSidebar', () => ({ default: () => null }));
vi.mock('../desktop/FilterPanel', () => ({ default: () => null }));
vi.mock('../desktop/StatsBar', () => ({ default: () => null }));
vi.mock('../desktop/StudentTable', () => ({ default: () => null }));
vi.mock('../desktop/PaginationBar', () => ({ default: () => null }));
vi.mock('../desktop/FollowingView', () => ({ default: () => null }));
vi.mock('../desktop/HandledView', () => ({ default: () => null }));
vi.mock('../desktop/StudentDetailDrawer', () => ({ default: () => null }));

const invalidStudent = {
  id: 7,
  name: '李小明',
  region: '',
  school_name: '',
  guardian_phone: '',
  status: '无效',
  queue: 'closed',
  queue_label: '已移出（无效）',
  in_my_lists: false,
};

function renderDesktop(overrides = {}) {
  const props = {
    user: { name: '小王' },
    viewTab: 'today',
    setViewTab: vi.fn(),
    students: [],
    filteredStudents: [],
    filteredStats: { total: 0 },
    taskProgress: {},
    intentCounts: {},
    schoolGroups: [],
    sortConfig: {},
    setSortConfig: vi.fn(),
    loadDetail: vi.fn().mockResolvedValue(undefined),
    setShowDetail: vi.fn(),
    ...overrides,
  };
  render(<AgentWorkDesktop {...props} />);
  return props;
}

describe('AgentWorkDesktop search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('finds a student outside the loaded lists and opens their detail', async () => {
    api.get.mockResolvedValue({
      data: { code: 0, data: { list: [invalidStudent], total: 1 } },
    });
    const props = renderDesktop();

    fireEvent.click(screen.getByLabelText('搜索我的全部学生'));
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '李小明' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(api.get).toHaveBeenCalledWith('/tasks/search', { params: { q: '李小明' } });
    await act(async () => {
      fireEvent.click(screen.getByText('李小明'));
    });

    expect(props.loadDetail).toHaveBeenCalledWith(7);
    expect(props.setShowDetail).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog', { name: '搜索我的学生' })).toBeNull();
  });
});
