import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DialResultModal from '../DialResultModal';

const results = [
  { code: 'new_lead', label: '新线索', className: 'bg-gray-500' },
  { code: 'very_interested', label: '非常有意向', className: 'bg-red-600' },
  { code: 'interested_wechat', label: '意向了解加微', className: 'bg-amber-600' },
  { code: 'missed_call', label: '未接', className: 'bg-gray-600' },
  { code: 'phone_invalid', label: '空号', className: 'bg-stone-600' },
  { code: 'high_score', label: '高分段', className: 'bg-indigo-600' },
  { code: 'no_intent', label: '无意向', className: 'bg-slate-600' },
  { code: 'child_declined', label: '孩子不想读', className: 'bg-zinc-600' },
  { code: 'enrolled_elsewhere', label: '已报名其他学校', className: 'bg-rose-600' },
  { code: 'enrolled', label: '已报名', className: 'bg-green-600' },
];

vi.mock('../../../../hooks/useLeadOutcomeCatalog', () => ({
  default: () => ({ results }),
}));

const defaultProps = {
  dialModal: {
    studentId: 42,
    studentName: '林同学',
    dialLogId: 9001,
  },
  onStatusSelect: vi.fn(),
  onIntentSelect: vi.fn(),
  onFollowUpSelect: vi.fn(),
  onClose: vi.fn(),
  mobile: true,
};

describe('DialResultModal mobile sheet', () => {
  it('keeps common outcomes in the first thumb-sized view and expands the rest', async () => {
    const user = userEvent.setup();
    render(<DialResultModal {...defaultProps} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '非常有意向' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '高分段' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '更多结果 (4)' }));

    expect(screen.getByRole('button', { name: '高分段' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已报名其他学校' })).toBeInTheDocument();
  });

  it('blocks duplicate result taps until the first save finishes', async () => {
    const user = userEvent.setup();
    let resolveSave;
    const onStatusSelect = vi.fn(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    render(<DialResultModal {...defaultProps} onStatusSelect={onStatusSelect} />);
    const missedButton = screen.getByRole('button', { name: '未接' });

    await user.click(missedButton);
    await user.click(missedButton);

    expect(onStatusSelect).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave();
    });
  });

  it('does not mark a skipped intent step as a completed flow', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DialResultModal
        {...defaultProps}
        dialModal={{ ...defaultProps.dialModal, showIntent: true, status: '已联系' }}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: '跳过' }));

    expect(onClose).toHaveBeenCalledWith();
  });
});
