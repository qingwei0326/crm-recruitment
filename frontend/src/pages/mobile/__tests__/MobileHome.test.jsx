import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PendingList, StudentRow } from '../MobileHome';
import { getStudentNextAction } from '../../../utils/studentNextAction';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('MobileHome PendingList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: [{ id: 8, name: '今晚再打', member_count: 2 }] } });
      }
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: 3,
            counts: { 已联系: 1, 未接: 1, 待回访: 1 },
            regions: [
              { name: '长泰县', count: 2 },
              { name: '漳浦县', count: 1 },
            ],
            list: [],
          },
        },
      });
    });
    api.post.mockResolvedValue({ data: { code: 0, data: { added_count: 1 } } });
  });

  it('renders status filters and requests follow-up items on selection', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: '全部 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已联系 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未接 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '待回访 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '长泰县 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '漳浦县 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '待回访 1' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, status: '待回访' },
      });
    });
  });

  it('does not expose intent-level filters in the mobile pending queue', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '全部 3' });
    expect(screen.queryByRole('button', { name: '全部意向' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'B' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'C' })).not.toBeInTheDocument();
  });

  it('requests pending items by waiting-volunteer result', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '等待志愿' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, status_detail: '等待志愿' },
      });
    });
  });

  it('requests pending items by private group', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '今晚再打 2' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, personal_group_id: 8 },
      });
    });
  });

  it('requests only students without a private group', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '未分组' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, ungrouped: true },
      });
    });
  });

  it('shows group badges and batch-adds selected students on mobile', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({
          data: { code: 0, data: [{ id: 8, name: '今晚再打', color: 'cyan', member_count: 2 }] },
        });
      }
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: 1,
            list_total: 1,
            counts: { 待回访: 1 },
            regions: [],
            list: [{
              id: 12,
              name: '陈同学',
              status: '待回访',
              school_name: '二中',
              personal_groups: [{ id: 8, name: '今晚再打', color: 'cyan' }],
            }],
          },
        },
      });
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    expect(await screen.findByText('陈同学')).toBeInTheDocument();
    expect(screen.getByText('今晚再打', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批量整理学生分组' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 陈同学' }));
    fireEvent.change(screen.getByRole('combobox', { name: '批量加入的分组' }), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/personal-groups/8/members', {
        student_ids: [12],
      });
    });
  });

  it('removes batch-grouped students from the ungrouped queue', async () => {
    let grouped = false;
    const student = {
      id: 13,
      name: '未分组学生',
      status: '待回访',
      school_name: '三中',
      personal_groups: [],
    };
    api.get.mockImplementation((url, options = {}) => {
      if (url === '/personal-groups') {
        return Promise.resolve({
          data: { code: 0, data: [{ id: 8, name: '今晚再打', color: 'cyan', member_count: 2 }] },
        });
      }
      const ungroupedList = options.params?.ungrouped && grouped ? [] : [student];
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: ungroupedList.length,
            list_total: ungroupedList.length,
            counts: { 待回访: ungroupedList.length },
            regions: [],
            list: ungroupedList,
          },
        },
      });
    });
    api.post.mockImplementation(() => {
      grouped = true;
      return Promise.resolve({ data: { code: 0, data: { added_count: 1 } } });
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '未分组' }));
    expect(await screen.findByText('未分组学生')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批量整理学生分组' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 未分组学生' }));
    fireEvent.change(screen.getByRole('combobox', { name: '批量加入的分组' }), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));

    await waitFor(() => expect(screen.queryByText('未分组学生')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/personal-groups/8/members', {
      student_ids: [13],
    });
  });

  it('loads more than the first mobile page', async () => {
    api.get.mockImplementation((url, options = {}) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: [] } });
      }
      const offset = options.params?.offset || 0;
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: 2,
            list_total: 2,
            counts: { 已联系: 2 },
            regions: [],
            list: offset === 0
              ? [{ id: 1, name: '第一页学生', status: '已联系' }]
              : [{ id: 2, name: '第二页学生', status: '已联系' }],
          },
        },
      });
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第一页学生')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多（剩余1）' }));

    expect(await screen.findByText('第二页学生')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/tasks/handled', {
      params: { limit: 100, offset: 1 },
    });
  });

  it('resets pagination when a filter refresh supersedes a pending page request', async () => {
    let finishMore;
    const payload = (id, name) => ({
      data: {
        code: 0,
        data: {
          total: 201,
          list_total: 201,
          counts: { 已联系: 201 },
          regions: [],
          list: [{ id, name, status: '已联系' }],
        },
      },
    });
    api.get.mockImplementation((url, options = {}) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: [] } });
      }
      if (options.params?.offset) {
        return new Promise((resolve) => { finishMore = resolve; });
      }
      return Promise.resolve(options.params?.search
        ? payload(2, '筛选后的学生')
        : payload(1, '原来的学生'));
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    await screen.findByText('原来的学生');
    fireEvent.click(screen.getByRole('button', { name: '加载更多（剩余200）' }));
    expect(finishMore).toBeTypeOf('function');
    fireEvent.change(screen.getByPlaceholderText('搜索姓名或手机号尾号'), {
      target: { value: '筛选' },
    });

    await screen.findByText('筛选后的学生');
    await act(async () => { finishMore(payload(3, '旧分页学生')); });
    expect(screen.queryByText('旧分页学生')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加载更多（剩余200）' })).not.toBeDisabled();
  });

  it('restores loaded pages and scroll position after returning from a student detail', async () => {
    let returning = false;
    api.get.mockImplementation((url, options = {}) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: [] } });
      }
      if (returning) {
        return new Promise(() => {});
      }
      const offset = options.params?.offset || 0;
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: 2,
            list_total: 2,
            counts: { 待回访: 2 },
            regions: [],
            list: offset === 0
              ? [{ id: 1, name: '第一页学生', status: '待回访' }]
              : [{ id: 2, name: '第二页学生', status: '待回访' }],
          },
        },
      });
    });

    const first = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );
    expect(await screen.findByText('第一页学生')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多（剩余1）' }));
    expect(await screen.findByText('第二页学生')).toBeInTheDocument();

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 720 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /第二页学生/ }));
    first.unmount();

    returning = true;
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第二页学生')).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 720 }));
    });

  });

  it('requests pending items by name or phone tail search', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    const search = await screen.findByPlaceholderText('搜索姓名或手机号尾号');
    fireEvent.change(search, { target: { value: '8888' } });
    fireEvent.click(screen.getByRole('button', { name: '待回访 1' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, status: '待回访', search: '8888' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '清空待处理搜索' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, status: '待回访' },
      });
    });
  });

  it('restores the original follow-up filters after returning from a student detail', async () => {
    const first = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '长泰县 2' });
    fireEvent.click(screen.getByRole('button', { name: '待回访 1' }));
    fireEvent.click(screen.getByRole('button', { name: '等待志愿' }));
    fireEvent.click(screen.getByRole('button', { name: '长泰县 2' }));
    fireEvent.change(screen.getByPlaceholderText('搜索姓名或手机号尾号'), {
      target: { value: '林' },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: {
          limit: 100,
          status: '待回访',
          status_detail: '等待志愿',
          region: '长泰县',
          search: '林',
        },
      });
    });

    first.unmount();
    vi.clearAllMocks();

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: {
          limit: 100,
          status: '待回访',
          status_detail: '等待志愿',
          region: '长泰县',
          search: '林',
        },
      });
    });
    expect(screen.getByPlaceholderText('搜索姓名或手机号尾号')).toHaveValue('林');
  });

  it('requests pending items by region with existing filters', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PendingList />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: '长泰县 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '待回访 1' }));
    fireEvent.click(screen.getByRole('button', { name: '长泰县 2' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, status: '待回访', region: '长泰县' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '全部区域' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, status: '待回访' },
      });
    });
  });
});

describe('MobileHome StudentRow next action', () => {
  const baseStudent = {
    id: 42,
    name: '张三',
    school_name: '第一中学',
    region: '芗城',
    status: '未联系',
    stage: '初次联系',
    intent_level: '无',
    guardian_name: '张妈妈',
    guardian_phone: '13800000000',
    guardian2_name: '',
    guardian2_phone: '',
  };

  it('derives a concise next action from phone, status, intent, and stage', () => {
    expect(getStudentNextAction(baseStudent, false).label).toBe('无电话数据');
    expect(getStudentNextAction({ ...baseStudent, status: '未联系' }, true).label).toBe('下一步：首次呼出');
    expect(getStudentNextAction({ ...baseStudent, status: '未接' }, true).label).toBe('下一步：再次呼出或设回访');
    expect(getStudentNextAction({ ...baseStudent, status: '待回访' }, true).label).toBe('下一步：按约定回访');
    expect(getStudentNextAction({ ...baseStudent, status: '已联系', intent_level: 'A' }, true).label).toBe('下一步：优先推进到访/报名');
    expect(getStudentNextAction({ ...baseStudent, status: '已联系', stage: '待家访', intent_level: 'A' }, true).label).toBe('下一步：确认家访安排');
    expect(getStudentNextAction({ ...baseStudent, status: '已联系', stage: '家访完成', intent_level: 'A' }, true).label).toBe('下一步：安排到校参观');
    expect(getStudentNextAction({ ...baseStudent, status: '已联系', stage: '到校参观已安排', intent_level: 'A' }, true).label).toBe('下一步：确认到访安排');
    expect(getStudentNextAction({ ...baseStudent, status: '已联系', stage: '已到校参观', intent_level: 'A' }, true).label).toBe('下一步：跟进入读报名');
    expect(getStudentNextAction({ ...baseStudent, status: '已联系', stage: '预约参观', intent_level: 'B' }, true).label).toBe('下一步：确认到访安排');
  });

  it('keeps the task card focused on the primary dial action', () => {
    const onDetail = vi.fn();
    const onDial = vi.fn();

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <StudentRow
          s={{ ...baseStudent, status: '未接' }}
          dialCount={1}
          dialMax={3}
          onDial={onDial}
          onDetail={onDetail}
          dialing={false}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('下一步：再次呼出或设回访')).not.toBeInTheDocument();
    expect(screen.queryByText('13800000000')).not.toBeInTheDocument();
    expect(screen.queryByText('无')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '拨打 张三 张妈妈' }));
    expect(onDial).toHaveBeenCalledWith(42, 'guardian');
  });

  it('falls back to no-phone data when a legacy no-contact card is rendered', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <StudentRow
          s={{ ...baseStudent, guardian_phone: '', guardian_name: '', status: '未联系' }}
          dialCount={0}
          dialMax={3}
          onDial={vi.fn()}
          onDetail={vi.fn()}
          dialing={false}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('无电话数据')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '无电话' })).toBeDisabled();
  });
});
