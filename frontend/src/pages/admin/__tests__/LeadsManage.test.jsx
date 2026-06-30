import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LeadsManage from '../LeadsManage';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

describe('LeadsManage privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === '/students') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              total: 1,
              list: [
                {
                  id: 10,
                  name: '脱敏学生',
                  region: '龙文区',
                  score: 580,
                  guardian_name: '林父',
                  guardian_phone: '139****8706',
                  guardian_phone_raw: null,
                  guardian2_name: '林母',
                  guardian2_phone: '189****0618',
                  guardian2_phone_raw: null,
                  school_name: '龙文中学',
                  status: '未联系',
                  stage: '初次联系',
                  intent_level: '无',
                },
              ],
            },
          },
        });
      }
      if (url === '/admin/agents') {
        return Promise.resolve({ data: { code: 0, data: [{ id: 2, name: '陈老师' }] } });
      }
      if (url === '/stats/stages') {
        return Promise.resolve({ data: { code: 0, data: {} } });
      }
      if (url === '/students/10') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              id: 10,
              name: '脱敏学生',
              guardian_phone: '139****8706',
              guardian_phone_raw: null,
              guardian2_phone: '189****0618',
              guardian2_phone_raw: null,
            },
          },
        });
      }
      if (url === '/notes?student_id=10') {
        return Promise.resolve({ data: { code: 0, data: [] } });
      }
      if (url === '/students/10/phone-plain') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              guardian_phone: '13960118706',
              guardian2_phone: '18960100618',
            },
          },
        });
      }
      if (url === '/students/phone/10') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              guardian_phone: '13960118706',
              guardian2_phone: '18960100618',
            },
          },
        });
      }
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
  });

  it('loads plaintext phone through the audited endpoint before editing', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('脱敏学生'));
    fireEvent.click(await screen.findByRole('button', { name: /编辑信息/ }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/students/10/phone-plain');
    });
    expect(await screen.findByDisplayValue('13960118706')).toBeInTheDocument();
    expect(screen.getByDisplayValue('18960100618')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('139****8706')).not.toBeInTheDocument();
  });

  it('lets admins click phone numbers in expanded student rows to dial', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: 'http://localhost/' },
    });

    try {
      render(
        <MemoryRouter initialEntries={['/admin/leads']}>
          <LeadsManage />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByText('脱敏学生'));
      fireEvent.click(await screen.findByRole('button', { name: /拨打监护人电话/ }));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/students/phone/10');
      });
      expect(window.location.href).toBe('tel:13960118706');
    } finally {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      });
    }
  });

  it('renders compact filters and applies ownership filters from the dropdown', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A 级未报名' })).not.toBeInTheDocument();
    expect(screen.queryByText('搜索姓名/电话/学校...')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜姓名 / 电话 / 学校')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /需协助/ })).toHaveClass('whitespace-nowrap');
    expect(await screen.findByRole('option', { name: '陈老师' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '按分配状态筛选学生' }), {
      target: { value: 'unassigned' },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/students',
        expect.objectContaining({
          params: expect.objectContaining({ assignment: 'unassigned' }),
        }),
      );
    });
    expect(screen.getByRole('button', { name: /未分配/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '按分配状态筛选学生' }), {
      target: { value: 'agent:2' },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/students',
        expect.objectContaining({
          params: expect.objectContaining({ assigned_to: '2' }),
        }),
      );
    });
    expect(screen.getByRole('button', { name: /归属：陈老师/ })).toBeInTheDocument();
  });
});
