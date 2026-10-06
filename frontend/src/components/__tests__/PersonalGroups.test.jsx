import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../api';
import {
  PersonalGroupBulkBar,
  PersonalGroupFilter,
  PersonalGroupMembershipEditor,
  UNGROUPED_FILTER,
} from '../PersonalGroups';

const { mockConfirm } = vi.hoisted(() => ({ mockConfirm: vi.fn() }));

vi.mock('../ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const groups = [
  { id: 1, name: '今晚再打', color: 'cyan', member_count: 2 },
  { id: 2, name: '等成绩', color: 'blue', member_count: 1 },
];

describe('PersonalGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    localStorage.clear();
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: groups } });
      }
      if (url === '/personal-groups/student/9') {
        return Promise.resolve({ data: { code: 0, data: { group_ids: [1] } } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
  });

  it('loads private groups and selects one as a queue filter', async () => {
    const onSelect = vi.fn();
    render(<PersonalGroupFilter selectedGroupId={null} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: '今晚再打 2' }));

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('creates a group from the filter bar', async () => {
    const groupList = [...groups];
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: groupList } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    api.post.mockImplementation(() => {
      const created = { id: 3, name: '本周重点', color: 'blue', member_count: 0 };
      groupList.push(created);
      return Promise.resolve({ data: { code: 0, data: created } });
    });
    const onSelect = vi.fn();
    render(<PersonalGroupFilter selectedGroupId={null} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: '新建分组' }));
    fireEvent.change(screen.getByRole('textbox', { name: '分组名称' }), {
      target: { value: '本周重点' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'blue色' }));
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/personal-groups', {
        name: '本周重点',
        color: 'blue',
      });
    });
    expect(await screen.findByRole('button', { name: '本周重点 0' })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('selects ungrouped students without treating it as a group id', async () => {
    const onSelect = vi.fn();
    render(<PersonalGroupFilter selectedGroupId={null} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: '未分组' }));

    expect(onSelect).toHaveBeenCalledWith(UNGROUPED_FILTER);
  });

  it('shows recent groups first and searches the complete group list', async () => {
    const manyGroups = [
      { id: 1, name: '今晚再打', member_count: 8 },
      { id: 2, name: '等成绩', member_count: 7 },
      { id: 3, name: '本周重点', member_count: 6 },
      { id: 4, name: '已加微信', member_count: 5 },
      { id: 5, name: '长期跟进', member_count: 1 },
      { id: 6, name: '等家长回复', member_count: 0 },
    ];
    localStorage.setItem('crm_user', JSON.stringify({ id: 7 }));
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: manyGroups } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    const onSelect = vi.fn();
    const first = render(<PersonalGroupFilter selectedGroupId={null} onSelect={onSelect} />);

    expect(await screen.findByText('我的分组')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今晚再打 8' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '长期跟进 1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开全部分组' }));
    const search = screen.getByPlaceholderText('搜索分组名称');
    fireEvent.change(search, { target: { value: '长期' } });
    fireEvent.click(screen.getByRole('button', { name: '长期跟进 1' }));
    expect(onSelect).toHaveBeenCalledWith(5);

    first.unmount();
    render(<PersonalGroupFilter selectedGroupId={null} onSelect={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '长期跟进 1' })).toBeInTheDocument();
  });

  it('waits for membership state before enabling group toggles', async () => {
    let resolveMembership;
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: groups } });
      }
      if (url === '/personal-groups/student/9') {
        return new Promise((resolve) => {
          resolveMembership = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    render(<PersonalGroupMembershipEditor studentId={9} />);

    expect(await screen.findByText('正在加载我的分组…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '今晚再打 未加入' })).not.toBeInTheDocument();

    resolveMembership({ data: { code: 0, data: { group_ids: [1] } } });
    expect(await screen.findByRole('button', { name: '今晚再打 已加入' })).toBeEnabled();
  });

  it('adds and removes a student from private groups', async () => {
    api.post.mockResolvedValue({ data: { code: 0, data: { added_count: 1 } } });
    api.delete.mockResolvedValue({ data: { code: 0, data: {} } });
    render(<PersonalGroupMembershipEditor studentId={9} />);

    await screen.findByRole('button', { name: '今晚再打 已加入' });
    const second = screen.getByRole('button', { name: '等成绩 未加入' });

    fireEvent.click(second);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/personal-groups/2/members', {
        student_ids: [9],
      });
    });
    await screen.findByRole('button', { name: '等成绩 已加入' });

    fireEvent.click(screen.getByRole('button', { name: '今晚再打 已加入' }));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/personal-groups/1/members/9');
    });
  });

  it('creates a group from student detail and immediately adds the student', async () => {
    const groupList = [...groups];
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: groupList } });
      }
      if (url === '/personal-groups/student/9') {
        return Promise.resolve({ data: { code: 0, data: { group_ids: [1] } } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    api.post.mockImplementation((url) => {
      if (url === '/personal-groups') {
        const created = { id: 3, name: '明早回访', color: 'green', member_count: 0 };
        groupList.push(created);
        return Promise.resolve({ data: { code: 0, data: created } });
      }
      if (url === '/personal-groups/3/members') {
        return Promise.resolve({ data: { code: 0, data: { added_count: 1 } } });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    render(<PersonalGroupMembershipEditor studentId={9} />);

    fireEvent.click(await screen.findByRole('button', { name: '在详情中新建分组' }));
    fireEvent.change(screen.getByRole('textbox', { name: '分组名称' }), {
      target: { value: '明早回访' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'green色' }));
    fireEvent.click(screen.getByRole('button', { name: '创建并加入' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/personal-groups/3/members', {
        student_ids: [9],
      });
    });
    expect(await screen.findByRole('button', { name: '明早回访 已加入' })).toBeInTheDocument();
  });

  it('adds multiple selected students to one group', async () => {
    const onApplied = vi.fn();
    api.post.mockResolvedValue({ data: { code: 0, data: { added_count: 2 } } });
    render(
      <PersonalGroupBulkBar
        selectedStudentIds={[9, 10]}
        onApplied={onApplied}
        onCancel={vi.fn()}
      />,
    );

    const select = await screen.findByRole('combobox', { name: '批量加入的分组' });
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/personal-groups/2/members', {
        student_ids: [9, 10],
      });
    });
    expect(onApplied).toHaveBeenCalledWith(groups[1]);
  });

  it('splits bulk grouping into backend-sized batches', async () => {
    const selectedStudentIds = Array.from({ length: 201 }, (_, index) => index + 1);
    api.post.mockResolvedValue({ data: { code: 0, data: { added_count: 200 } } });
    render(
      <PersonalGroupBulkBar
        selectedStudentIds={selectedStudentIds}
        onApplied={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(await screen.findByRole('combobox', { name: '批量加入的分组' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, '/personal-groups/1/members', {
      student_ids: selectedStudentIds.slice(0, 200),
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/personal-groups/1/members', {
      student_ids: [201],
    });
  });

  it('deletes a private group only after the in-app confirm is accepted', async () => {
    const onSelect = vi.fn();
    api.delete.mockResolvedValue({ data: { code: 0, data: {} } });
    render(<PersonalGroupFilter selectedGroupId={1} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: '管理当前分组' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/personal-groups/1'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'danger',
      message: expect.stringContaining('今晚再打'),
    }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('keeps the group when the delete confirm is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    render(<PersonalGroupFilter selectedGroupId={1} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '管理当前分组' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(api.delete).not.toHaveBeenCalled();
  });
});
