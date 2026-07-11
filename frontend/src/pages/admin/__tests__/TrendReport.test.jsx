import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TrendReport from '../TrendReport';
import api from '../../../api';

const { toastError, tooltipProps } = vi.hoisted(() => ({
  toastError: vi.fn(),
  tooltipProps: [],
}));

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: 'admin',
      name: '管理员',
      operation_permissions: ['report_export'],
    },
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

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ error: toastError }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-chart">{children}</div>,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: ({ name, dataKey, stroke }) => (
    <div data-testid="chart-line" data-name={name} data-key={dataKey} data-stroke={stroke}>
      {name}
    </div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: (props) => {
    tooltipProps.push(props);
    return null;
  },
  Legend: () => null,
}));

const idPayload = {
  start: '2026-07-01',
  end: '2026-07-10',
  agents: [
    { id: 14, name: '邹欣辰', is_active: true },
    { id: 15, name: '离职无数据', is_active: false },
  ],
  daily: [
    {
      date: '2026-07-10',
      calls: 3,
      enrolled: 0,
      prev_calls: 2,
      agent_calls_by_id: { 14: 3, 15: 0 },
      agent_calls: { 邹欣辰: 3, 离职无数据: 0 },
    },
  ],
};

function renderComponent(props = {}) {
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/admin/trend']}
    >
      <TrendReport {...props} />
    </MemoryRouter>,
  );
}

function renderTrendReport(payload, props = {}) {
  api.get.mockResolvedValue({ data: { data: payload } });
  renderComponent(props);
}

function chartLineNames() {
  return screen.getAllByTestId('chart-line').map((line) => line.dataset.name);
}

describe('TrendReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tooltipProps.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders only non-zero trend and legacy agent series', async () => {
    renderTrendReport({
      start: '2026-06-01',
      end: '2026-06-30',
      daily: [
        {
          date: '2026-06-25',
          calls: 0,
          enrolled: 0,
          agent_calls: { 叶: 0, 陈: 0, 苏丹丹: 0, 蒲安琪: 0 },
        },
        {
          date: '2026-06-26',
          calls: 8,
          enrolled: 0,
          agent_calls: { 叶: 0, 陈: 3, 苏丹丹: 0, 蒲安琪: 5 },
        },
      ],
    });

    expect(await screen.findByText('每日趋势')).toBeInTheDocument();
    expect(screen.getByText('各话务员每日呼出量对比')).toBeInTheDocument();

    expect(chartLineNames()).toEqual(['呼出量', '陈', '蒲安琪']);
    expect(screen.queryByText('叶')).not.toBeInTheDocument();
    expect(screen.queryByText('苏丹丹')).not.toBeInTheDocument();
  });

  it('renders every non-zero legacy agent when more agents exist than the color palette', async () => {
    const activeNames = Array.from({ length: 11 }, (_, index) => `话务员${index + 1}`);
    const agentCalls = Object.fromEntries([
      ...activeNames.map((name, index) => [name, index + 1]),
      ['离职无数据', 0],
    ]);

    renderTrendReport({
      start: '2026-07-10',
      end: '2026-07-10',
      daily: [
        {
          date: '2026-07-10',
          calls: 66,
          enrolled: 0,
          agent_calls: agentCalls,
        },
      ],
    });

    expect(await screen.findByText('各话务员每日呼出量对比')).toBeInTheDocument();

    const agentLines = screen
      .getAllByTestId('chart-line')
      .filter((line) => activeNames.includes(line.dataset.name));
    expect(agentLines.map((line) => line.dataset.name)).toEqual(activeNames);
    expect(agentLines.every((line) => Boolean(line.dataset.stroke))).toBe(true);
    activeNames.forEach((name) => {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    });
    expect(screen.queryByText('离职无数据')).not.toBeInTheDocument();
  });

  it('hides the agent comparison chart when every agent is zero', async () => {
    renderTrendReport({
      start: '2026-06-25',
      end: '2026-06-25',
      daily: [
        {
          date: '2026-06-25',
          calls: 4,
          enrolled: 0,
          agent_calls: { 叶: 0, 陈: 0 },
        },
      ],
    });

    expect(await screen.findByText('每日趋势')).toBeInTheDocument();

    expect(screen.queryByText('各话务员每日呼出量对比')).not.toBeInTheDocument();
    expect(chartLineNames()).toEqual(['呼出量']);
    expect(screen.queryByText('叶')).not.toBeInTheDocument();
    expect(screen.queryByText('陈')).not.toBeInTheDocument();
  });

  it('uses ID series and lets the legend hide and restore a curve', async () => {
    renderTrendReport(idPayload);
    expect(await screen.findByText('各话务员每日呼出量对比')).toBeInTheDocument();

    const agentLine = () =>
      screen
        .queryAllByTestId('chart-line')
        .find((line) => line.dataset.name === '邹欣辰');
    expect(chartLineNames()).toEqual(['呼出量', '上周同期', '邹欣辰']);
    expect(agentLine()?.dataset.key).toBe('agent_14');
    expect(screen.queryByText('离职无数据')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '邹欣辰' }));
    expect(agentLine()).toBeUndefined();
    expect(screen.getByRole('columnheader', { name: '邹欣辰' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部显示' }));
    expect(agentLine()).toBeDefined();
  });

  it('keeps legacy agent colors stable when an earlier curve is hidden', async () => {
    renderTrendReport({
      start: '2026-07-10',
      end: '2026-07-10',
      daily: [
        {
          date: '2026-07-10',
          calls: 3,
          enrolled: 0,
          agent_calls: { 甲: 1, 乙: 2 },
        },
      ],
    });
    await screen.findByText('各话务员每日呼出量对比');

    const agentLine = (name) =>
      screen
        .queryAllByTestId('chart-line')
        .find((line) => line.dataset.name === name);
    const secondAgentColor = agentLine('乙').dataset.stroke;

    fireEvent.click(screen.getByRole('checkbox', { name: '甲' }));

    expect(agentLine('乙').dataset.stroke).toBe(secondAgentColor);
  });

  it('sorts the agent tooltip by the hovered date value descending', async () => {
    renderTrendReport({
      start: '2026-07-10',
      end: '2026-07-10',
      daily: [
        {
          date: '2026-07-10',
          calls: 13,
          enrolled: 0,
          agent_calls: { 零值: 0, 较低: 2, 最高: 9, 同值: 2 },
        },
      ],
    });
    await screen.findByText('各话务员每日呼出量对比');

    expect(tooltipProps).toHaveLength(2);
    expect(tooltipProps[0].itemSorter).toBeUndefined();
    const agentTooltip = tooltipProps[1];
    expect(agentTooltip.itemSorter).toEqual(expect.any(Function));

    const entries = [
      { name: '零值', value: 0 },
      { name: '较低', value: 2 },
      { name: '最高', value: 9 },
      { name: '同值', value: 2 },
      { name: '无效', value: 'not-a-number' },
    ];
    const { DefaultTooltipContent } = await vi.importActual('recharts');
    const { container } = render(
      <DefaultTooltipContent
        label="2026-07-10"
        payload={entries}
        itemSorter={agentTooltip.itemSorter}
      />,
    );
    const orderedNames = [
      ...container.querySelectorAll('.recharts-tooltip-item-name'),
    ].map((element) => element.textContent);

    expect(orderedNames).toEqual(['最高', '较低', '同值', '零值', '无效']);
    expect(agentTooltip.itemSorter({})).toBe(0);
    expect(agentTooltip.itemSorter({ value: null })).toBe(0);
  });

  it('requests natural CST week and month ranges', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-05T16:30:00Z'));
    renderTrendReport(idPayload);
    await screen.findByText('每日趋势');

    fireEvent.click(screen.getByRole('button', { name: '本周' }));
    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/stats/trend', {
        params: { start_date: '2026-07-06', end_date: '2026-07-06' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '本月' }));
    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/stats/trend', {
        params: { start_date: '2026-07-01', end_date: '2026-07-06' },
      });
    });
  });

  it('blocks a reversed custom range before requesting', async () => {
    renderTrendReport(idPayload);
    await screen.findByText('每日趋势');

    fireEvent.change(screen.getByLabelText('开始日期'), {
      target: { value: '2026-07-11' },
    });
    fireEvent.change(screen.getByLabelText('结束日期'), {
      target: { value: '2026-07-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('开始日期不能晚于结束日期');
  });

  it('blocks a custom range longer than 366 days before requesting', async () => {
    renderTrendReport(idPayload);
    await screen.findByText('每日趋势');

    fireEvent.change(screen.getByLabelText('开始日期'), {
      target: { value: '2025-07-09' },
    });
    fireEvent.change(screen.getByLabelText('结束日期'), {
      target: { value: '2026-07-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('查询范围最多 366 天');
  });

  it('shows the backend range detail when loading fails', async () => {
    api.get.mockRejectedValueOnce({
      response: { data: { detail: '查询范围最多 366 天' } },
    });
    renderComponent();

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('查询范围最多 366 天');
    });
  });

  it('keeps hidden-agent data in the table and CSV export', async () => {
    renderTrendReport(idPayload);
    await screen.findByText('各话务员每日呼出量对比');
    fireEvent.click(screen.getByRole('checkbox', { name: '邹欣辰' }));

    expect(screen.getByRole('columnheader', { name: '邹欣辰' })).toBeInTheDocument();
    const dataRow = screen.getByRole('row', { name: '2026-07-10 3 0 3' });
    expect(within(dataRow).getAllByRole('cell')[3]).toHaveTextContent('3');

    const BlobMock = vi.fn(function Blob(parts, options) {
      this.parts = parts;
      this.options = options;
    });
    const createObjectURL = vi.fn(() => 'blob:trend-report');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    vi.stubGlobal('Blob', BlobMock);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    const csv = BlobMock.mock.calls[0][0].join('');
    expect(csv).toContain('日期,呼出量,报名数,邹欣辰');
    expect(csv).toContain('2026-07-10,3,0,3');
    expect(createObjectURL).toHaveBeenCalledWith(BlobMock.mock.instances[0]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:trend-report');
    expect(clickSpy.mock.instances[0].download).toBe('趋势报表_2026-07-10.csv');
  });

  it('shows the export action in the embedded report center view', async () => {
    renderTrendReport(idPayload, { embedded: true });

    expect(await screen.findByRole('button', { name: '导出' })).toBeEnabled();
  });
});
