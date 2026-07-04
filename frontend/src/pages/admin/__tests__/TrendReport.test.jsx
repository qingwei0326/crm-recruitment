import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TrendReport from '../TrendReport';
import api from '../../../api';

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
    user: { id: 1, role: 'admin', name: '管理员' },
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
  useToast: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-chart">{children}</div>,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: ({ name, dataKey }) => (
    <div data-testid="chart-line" data-name={name} data-key={dataKey}>
      {name}
    </div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

function renderTrendReport(daily) {
  api.get.mockResolvedValue({
    data: {
      data: {
        start: '2026-06-01',
        end: '2026-06-30',
        daily,
      },
    },
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/trend']}>
      <TrendReport />
    </MemoryRouter>,
  );
}

function chartLineNames() {
  return screen.getAllByTestId('chart-line').map((line) => line.dataset.name);
}

describe('TrendReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only non-zero trend and agent series', async () => {
    renderTrendReport([
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
    ]);

    expect(await screen.findByText('每日趋势')).toBeInTheDocument();
    expect(screen.getByText('各话务员每日呼出量对比')).toBeInTheDocument();

    expect(chartLineNames()).toEqual(['呼出量', '陈', '蒲安琪']);
    expect(screen.queryByText('叶')).not.toBeInTheDocument();
    expect(screen.queryByText('苏丹丹')).not.toBeInTheDocument();
  });

  it('hides the agent comparison chart when every agent is zero', async () => {
    renderTrendReport([
      {
        date: '2026-06-25',
        calls: 4,
        enrolled: 0,
        agent_calls: { 叶: 0, 陈: 0 },
      },
    ]);

    expect(await screen.findByText('每日趋势')).toBeInTheDocument();

    expect(screen.queryByText('各话务员每日呼出量对比')).not.toBeInTheDocument();
    expect(chartLineNames()).toEqual(['呼出量']);
    expect(screen.queryByText('叶')).not.toBeInTheDocument();
    expect(screen.queryByText('陈')).not.toBeInTheDocument();
  });
});
