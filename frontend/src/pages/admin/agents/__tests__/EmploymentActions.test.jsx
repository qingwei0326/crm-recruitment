import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EmploymentActions from '../EmploymentActions';
import { employmentLabel, employmentTone } from '../../agentManageUtils';

const handlers = {
  onSuspend: vi.fn(),
  onResume: vi.fn(),
  onStartHandover: vi.fn(),
  onOpenBatch: vi.fn(),
};

describe('employment lifecycle controls', () => {
  it.each([
    ['active', '在职'],
    ['suspended', '暂停'],
    ['handover_pending', '待交接'],
    ['offboarded', '已离职'],
  ])('labels %s as %s', (status, label) => {
    expect(employmentLabel(status)).toBe(label);
    expect(employmentTone(status)).toBeTruthy();
  });

  it('only exposes commands valid for the current lifecycle state', () => {
    const { rerender } = render(
      <EmploymentActions account={{ employment_status: 'active' }} {...handlers} />,
    );
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '办理离职' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '办理离职' }));
    expect(handlers.onStartHandover).toHaveBeenCalledOnce();

    rerender(<EmploymentActions account={{ employment_status: 'suspended' }} {...handlers} />);
    expect(screen.getByRole('button', { name: '恢复' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '办理离职' })).not.toBeInTheDocument();

    rerender(
      <EmploymentActions account={{ employment_status: 'handover_pending' }} {...handlers} />,
    );
    expect(screen.getByRole('button', { name: '打开交接批次' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂停' })).not.toBeInTheDocument();

    rerender(<EmploymentActions account={{ employment_status: 'offboarded' }} {...handlers} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
