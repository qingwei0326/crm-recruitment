import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileHome from '../MobileHome';
import api from '../../../api';

vi.mock('../../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { name: '测试' } }) }));
vi.mock('../../../components/MobileDialResult', () => ({ default: () => null }));

it('loads the next page while a school is selected', async () => {
  api.get.mockImplementation(async (url, { params } = {}) => {
    if (url !== '/tasks/today') return { data: { code: 0, data: {} } };
    const offset = params.offset || 0;
    return { data: { code: 0, data: {
      list: Array.from({ length: offset ? 1 : 30 }, (_, i) => ({
        id: offset + i + 1, name: `学生${offset + i + 1}`, status: '未联系',
      })),
      list_total: 31,
      schools: [{ name: '测试学校', count: 31 }, { name: '其他学校', count: 1 }],
    } } };
  });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <MobileHome />
  </MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /测试学校/ }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/tasks/today', {
    params: { limit: 30, offset: 0, school_name: '测试学校' },
  }));
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
  expect(await screen.findByText('学生31')).toBeInTheDocument();
  expect(api.get).toHaveBeenLastCalledWith('/tasks/today', {
    params: { limit: 30, offset: 30, school_name: '测试学校' },
  });
  expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
});
