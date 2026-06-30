import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DistributeBySchools from '../DistributeBySchools';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
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

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

describe('DistributeBySchools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === '/admin/unassigned-school-groups') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              groups: [
                { name: '龙海一中', region: '龙海区', count: 1 },
                { name: '龙海二中', region: '龙海区', count: 2 },
                { name: '漳浦一中', region: '漳浦县', count: 3 },
              ],
            },
          },
        });
      }
      if (url === '/admin/agents') {
        return Promise.resolve({ data: { code: 0, data: [] } });
      }
      if (url === '/students') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              list: [
                {
                  id: 10,
                  name: '张三',
                  region: '龙海',
                  score: 580,
                  guardian_name: '张父',
                },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
  });

  it('loads expanded unassigned students from the students endpoint', async () => {
    render(
      <MemoryRouter>
        <DistributeBySchools />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('龙海一中'));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/students', {
        params: {
          page: 1,
          page_size: 200,
          school_name: '龙海一中',
          assignment: 'unassigned',
        },
      });
    });
    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/admin/leads', expect.anything());
  });

  it('groups schools by region and can select one whole region', async () => {
    api.post.mockResolvedValue({
      data: {
        code: 0,
        data: { distributed_count: 3, distribution: { 测试坐席: 3 } },
      },
    });

    render(
      <MemoryRouter>
        <DistributeBySchools />
      </MemoryRouter>,
    );

    expect(await screen.findByText('龙海区')).toBeInTheDocument();
    expect(screen.getByText('漳浦县')).toBeInTheDocument();
    expect(screen.getByText('2 所学校')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('选择龙海区全部学校'));
    fireEvent.click(screen.getByText('分发所选学校'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admin/distribute-by-schools', {
        school_names: ['龙海一中', '龙海二中'],
        mode: 'auto',
      });
    });
  });
});
