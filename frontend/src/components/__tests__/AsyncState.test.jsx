import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContentSkeleton, EmptyState, ErrorState } from '../AsyncState';

describe('AsyncState', () => {
  it('renders an accessible loading skeleton', () => {
    render(<ContentSkeleton rows={2} />);
    expect(screen.getByRole('status', { name: '内容加载中' })).toBeInTheDocument();
  });

  it('renders the empty title and framed card by default', () => {
    const { container } = render(<EmptyState title="暂无待办" />);
    expect(screen.getByText('暂无待办')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('border-dashed');
  });

  it('drops the card frame in bare mode', () => {
    const { container } = render(<EmptyState bare title="暂无待办" />);
    expect(container.firstChild).not.toHaveClass('border-dashed');
    expect(container.firstChild).not.toHaveClass('rounded-panel');
  });

  it('shows a custom retry label and calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState bare title="加载失败" retryLabel="重试" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('defaults the retry label and omits the button without onRetry', () => {
    const { rerender } = render(<ErrorState onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    rerender(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
