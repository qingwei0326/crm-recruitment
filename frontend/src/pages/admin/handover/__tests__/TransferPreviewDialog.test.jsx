import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TransferPreviewDialog from '../TransferPreviewDialog';

const preview = {
  selectedCount: 3,
  openWorkItemCount: 5,
  overdueCount: 2,
  highIntentCount: 1,
  byKind: { lead_contact: 2, scheduled_follow_up: 2, home_visit: 1 },
  students: [{ studentId: 1, name: '测试学生甲' }],
};

describe('TransferPreviewDialog', () => {
  it('shows reviewed counts, mode, target and selected students', () => {
    render(
      <TransferPreviewDialog
        preview={preview}
        mode="selected"
        targetAgent={{ id: 8, name: '接手员工' }}
        submitting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/转派所选学生/)).toHaveTextContent('接手员工');
    expect(screen.getByText('测试学生甲')).toBeInTheDocument();
    expect(screen.getByText('开放工作项').parentElement).toHaveTextContent('5');
    expect(screen.getByText('逾期').parentElement).toHaveTextContent('2');
    expect(screen.getByText('A 级意向').parentElement).toHaveTextContent('1');
    expect(screen.getByText('学生跟进 2')).toBeInTheDocument();
    expect(screen.getByText('预约回访 2')).toBeInTheDocument();
    expect(screen.queryByText('lead_contact')).not.toBeInTheDocument();
  });

  it('blocks confirmation without an active target or while submitting', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <TransferPreviewDialog
        preview={preview}
        mode="all_remaining"
        targetAgent={null}
        submitting={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: '确认交接' })).toBeDisabled();

    rerender(
      <TransferPreviewDialog
        preview={preview}
        mode="all_remaining"
        targetAgent={{ id: 8, name: '接手员工' }}
        submitting
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '正在交接...' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
