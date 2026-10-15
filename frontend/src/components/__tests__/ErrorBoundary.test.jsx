import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// 抑制 console.error 在测试中的输出
const originalError = console.error;
beforeAll(() => {
  console.error = vi.fn();
});
afterAll(() => {
  console.error = originalError;
});

function ThrowError() {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('should render error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('页面出了点问题')).toBeInTheDocument();
    expect(screen.getByText('刷新页面')).toBeInTheDocument();
    expect(screen.queryByText('返回登录')).not.toBeInTheDocument();
  });

  it('explains a failed page download as a network problem', () => {
    function ChunkFailure() {
      throw new TypeError('Failed to fetch dynamically imported module: https://x/assets/A.js');
    }
    render(
      <ErrorBoundary>
        <ChunkFailure />
      </ErrorBoundary>
    );

    expect(screen.getByText('网络不稳，页面没加载完整')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.queryByText(/dynamically imported module/)).not.toBeInTheDocument();
  });

  it('should show error message', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Test error')).toBeInTheDocument();
  });
});
