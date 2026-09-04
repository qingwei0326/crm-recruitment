import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
