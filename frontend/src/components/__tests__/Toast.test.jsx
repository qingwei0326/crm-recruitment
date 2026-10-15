import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../Toast';

function ToastHarness() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.success('保存成功')}>成功提示</button>
      <button type="button" onClick={() => toast.error('网络异常')}>错误提示</button>
    </div>
  );
}

describe('ToastProvider', () => {
  it('announces feedback with the correct urgency and allows dismissal', () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '成功提示' }));
    expect(screen.getByRole('status')).toHaveTextContent('保存成功');

    fireEvent.click(screen.getByRole('button', { name: '错误提示' }));
    expect(screen.getByRole('alert')).toHaveTextContent('网络异常');

    const closeButtons = screen.getAllByRole('button', { name: '关闭提示' });
    fireEvent.click(closeButtons[1]);
    expect(screen.queryByText('网络异常')).not.toBeInTheDocument();
  });
});

describe('ToastProvider actions', () => {
  it('runs the toast action once and closes the toast', () => {
    const onClick = vi.fn();
    function ActionHarness() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => toast.success('已标记', { action: { label: '撤销', onClick } })}
        >
          带撤销提示
        </button>
      );
    }
    render(
      <ToastProvider>
        <ActionHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '带撤销提示' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已标记')).not.toBeInTheDocument();
  });
});
