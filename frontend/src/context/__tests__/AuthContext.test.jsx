import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function Probe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.name || 'none'}</span>
    </div>
  );
}

describe('AuthContext', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('clears cached user when auth check returns non-zero code', async () => {
    localStorage.setItem('crm_user', JSON.stringify({ id: 1, name: '旧用户' }));
    api.get.mockResolvedValue({ data: { code: -1, data: null } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('crm_user')).toBeNull();
  });
});
