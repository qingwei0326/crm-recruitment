import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TeamProgressPanel from '../TeamProgressPanel';
import api from '../../../../api';

vi.mock('../../../../api', () => ({ default: { get: vi.fn() } }));

const zero = {
  today_dials: 0,
  pending_dial: 0,
  overdue: 0,
  missed_waiting: 0,
  intent_ab: 0,
  intent_ab_quiet: 0,
  open_visits: 0,
  enrolled_today: 0,
  enrolled_total: 0,
};

const agentData = {
  group_by: 'agent',
  rows: [
    { ...zero, key: 3, label: '小王', is_active: true, needs_leads: true, today_dials: 41 },
    {
      ...zero,
      key: 2,
      label: '小李',
      is_active: true,
      needs_leads: false,
      today_dials: 12,
      pending_dial: 30,
      overdue: 6,
      missed_waiting: 9,
      intent_ab: 5,
      intent_ab_quiet: 2,
      open_visits: 1,
      enrolled_today: 1,
      enrolled_total: 4,
    },
  ],
  totals: { ...zero, today_dials: 53, pending_dial: 30, missed_waiting: 9, enrolled_total: 4 },
};

const regionData = {
  group_by: 'region',
  rows: [
    { ...zero, key: '东山', label: '东山', pending_dial: 20, missed_waiting: 3 },
    { ...zero, key: '', label: '未填片区', pending_dial: 2 },
  ],
  totals: { ...zero, pending_dial: 22, missed_waiting: 3 },
};

function renderPanel(props = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TeamProgressPanel canViewLeadsManage {...props} />
    </MemoryRouter>,
  );
}

function desktopTable() {
  return screen.getByRole('table');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url, { params }) =>
    Promise.resolve({
      data: { code: 0, data: params.group_by === 'region' ? regionData : agentData },
    }),
  );
});

describe('TeamProgressPanel', () => {
  it('shows what each agent still has to do and who has run out of leads', async () => {
    renderPanel();

    const table = await screen.findByRole('table');
    expect(api.get).toHaveBeenCalledWith('/admin/team-progress', { params: { group_by: 'agent' } });
    const liRow = within(table).getByRole('row', { name: /小李/ });
    expect(within(liRow).getByText('30')).toBeInTheDocument();
    expect(within(liRow).getByText('超24h 6')).toBeInTheDocument();
    expect(within(liRow).getByText('9')).toBeInTheDocument();
    expect(within(liRow).getByText('3天没联系 2')).toBeInTheDocument();
    const wangRow = within(table).getByRole('row', { name: /小王/ });
    expect(within(wangRow).getByText('已打完，可派新线索')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /合计/ })).toHaveTextContent('53');
  });

  it('links the counts to the matching lead list', async () => {
    renderPanel();

    const table = await screen.findByRole('table');
    const liRow = within(table).getByRole('row', { name: /小李/ });
    expect(within(liRow).getByRole('link', { name: '30' })).toHaveAttribute(
      'href',
      '/admin/leads?assigned_to=2&status=%E6%9C%AA%E8%81%94%E7%B3%BB',
    );
    expect(within(liRow).getByRole('link', { name: '9' })).toHaveAttribute(
      'href',
      '/admin/leads?assigned_to=2&status=%E6%9C%AA%E6%8E%A5',
    );
  });

  it('does not link counts for admins without the leads page', async () => {
    renderPanel({ canViewLeadsManage: false });

    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  it('switches to the region view', async () => {
    renderPanel();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: '按片区' }));

    await waitFor(() => {
      expect(within(desktopTable()).getByRole('row', { name: /东山/ })).toBeInTheDocument();
    });
    expect(api.get).toHaveBeenLastCalledWith('/admin/team-progress', { params: { group_by: 'region' } });
    const dongshan = within(desktopTable()).getByRole('row', { name: /东山/ });
    expect(within(dongshan).getByRole('link', { name: '20' })).toHaveAttribute(
      'href',
      '/admin/leads?region=%E4%B8%9C%E5%B1%B1&status=%E6%9C%AA%E8%81%94%E7%B3%BB',
    );
    const unknown = within(desktopTable()).getByRole('row', { name: /未填片区/ });
    expect(within(unknown).queryByRole('link')).not.toBeInTheDocument();
  });

  it('reloads when the page asks for a refresh', async () => {
    const { rerender } = renderPanel({ refreshKey: 0 });
    await screen.findByRole('table');

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TeamProgressPanel canViewLeadsManage refreshKey={1} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('shows the failure with a retry', async () => {
    api.get.mockRejectedValueOnce({ response: { data: { detail: '无权访问' } } });
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('explains an empty board', async () => {
    api.get.mockResolvedValue({ data: { code: 0, data: { group_by: 'agent', rows: [], totals: zero } } });
    renderPanel();

    expect(await screen.findByText('暂时没有进度数据')).toBeInTheDocument();
  });
});
