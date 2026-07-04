import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PendingList, StudentRow } from '../MobileHome';
import { getStudentNextAction } from '../../../utils/studentNextAction';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('MobileHome PendingList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({
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

  it('renders status filters and requests follow-up items on selection', async () => {
    render(
      <MemoryRouter>
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

  it('requests pending items by intent level', async () => {
    render(
      <MemoryRouter>
        <PendingList />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: '全部意向' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'B' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 100, intent_level: 'B' },
      });
    });
  });

  it('requests pending items by name or phone tail search', async () => {
    render(
      <MemoryRouter>
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

  it('requests pending items by region with existing filters', async () => {
    render(
      <MemoryRouter>
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

  it('shows the next action on the mobile student card', () => {
    const onDetail = vi.fn();
    const onDial = vi.fn();

    render(
      <MemoryRouter>
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

    expect(screen.getByText('下一步：再次呼出或设回访')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '拨打 张三 张妈妈' }));
    expect(onDial).toHaveBeenCalledWith(42, 'guardian');
  });

  it('falls back to no-phone data when a legacy no-contact card is rendered', () => {
    render(
      <MemoryRouter>
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

    expect(screen.getByText('无电话数据')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '无电话' })).toBeDisabled();
  });
});
