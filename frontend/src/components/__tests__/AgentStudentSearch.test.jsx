import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AgentStudentSearch from '../AgentStudentSearch';
import api from '../../api';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

const invalidStudent = {
  id: 7,
  name: '李小明',
  region: '长泰区',
  school_name: '第一中学',
  guardian_phone: '13866668888',
  status: '无效',
  queue: 'closed',
  queue_label: '已移出（无效）',
  in_my_lists: false,
};
const dialStudent = {
  id: 8,
  name: '李小红',
  region: '',
  school_name: '',
  guardian_phone: '',
  status: '未联系',
  queue: 'pending_dial',
  queue_label: '待拨打',
  in_my_lists: true,
};

function type(value) {
  fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value } });
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentStudentSearch', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<AgentStudentSearch open={false} onClose={vi.fn()} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('searches after a short pause and says where each student is', async () => {
    api.get.mockResolvedValue({
      data: { code: 0, data: { total: 2, list: [invalidStudent, dialStudent] } },
    });
    render(<AgentStudentSearch open onClose={vi.fn()} onPick={vi.fn()} />);

    type('李');
    expect(api.get).not.toHaveBeenCalled();
    await settle();

    expect(api.get).toHaveBeenCalledWith('/tasks/search', { params: { q: '李' } });
    expect(screen.getByText('李小明')).toBeInTheDocument();
    expect(screen.getByText('已移出（无效），不在你的列表里')).toBeInTheDocument();
    expect(screen.getByText('在「待拨打」里')).toBeInTheDocument();
  });

  it('opens the chosen student', async () => {
    api.get.mockResolvedValue({ data: { code: 0, data: { total: 1, list: [invalidStudent] } } });
    const onPick = vi.fn();
    render(<AgentStudentSearch open onClose={vi.fn()} onPick={onPick} />);

    type('李小明');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /李小明/ }));

    expect(onPick).toHaveBeenCalledWith(7);
  });

  it('explains an empty result and does not query for a blank keyword', async () => {
    api.get.mockResolvedValue({ data: { code: 0, data: { total: 0, list: [] } } });
    render(<AgentStudentSearch open onClose={vi.fn()} onPick={vi.fn()} />);

    type('   ');
    await settle();
    expect(api.get).not.toHaveBeenCalled();

    type('不存在');
    await settle();
    expect(screen.getByText(/没有找到「不存在」/)).toBeInTheDocument();
  });

  it('tells the agent when only the first results are shown', async () => {
    api.get.mockResolvedValue({
      data: { code: 0, data: { total: 41, list: [invalidStudent, dialStudent] } },
    });
    render(<AgentStudentSearch open onClose={vi.fn()} onPick={vi.fn()} />);

    type('李');
    await settle();

    expect(screen.getByText('共 41 个，只显示前 2 个，请输入更多字')).toBeInTheDocument();
  });

  it('shows the failure and keeps the keyword', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: '网络异常' } } });
    render(<AgentStudentSearch open onClose={vi.fn()} onPick={vi.fn()} />);

    type('李');
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('网络异常');
    expect(screen.getByLabelText('搜索关键词')).toHaveValue('李');
  });

  it('ignores a slow answer for an older keyword', async () => {
    let resolveFirst;
    api.get
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ data: { code: 0, data: { total: 1, list: [dialStudent] } } });
    render(<AgentStudentSearch open onClose={vi.fn()} onPick={vi.fn()} />);

    type('李');
    await settle();
    type('李小红');
    await settle();
    await act(async () => {
      resolveFirst({ data: { code: 0, data: { total: 1, list: [invalidStudent] } } });
    });

    expect(screen.getByText('李小红')).toBeInTheDocument();
    expect(screen.queryByText('李小明')).not.toBeInTheDocument();
  });
});
