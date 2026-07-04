import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HelpModal from '../HelpModal';

describe('HelpModal', () => {
  it('renders the normal admin guide', () => {
    render(<HelpModal isOpen onClose={() => {}} role="admin" />);

    expect(screen.getByRole('heading', { name: '管理员使用说明' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '线索治理' })).toBeInTheDocument();
  });

  it('renders the super admin guide with high-risk operation guidance', () => {
    render(<HelpModal isOpen onClose={() => {}} role="super_admin" />);

    expect(screen.getByRole('heading', { name: '超级管理员使用说明' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '权限边界' }));

    expect(screen.getByText(/清理重复手机号/)).toBeInTheDocument();
    expect(screen.getByText(/分配批次回滚/)).toBeInTheDocument();
  });

  it('renders the agent guide', () => {
    render(<HelpModal isOpen onClose={() => {}} role="agent" />);

    expect(screen.getByRole('heading', { name: '话务员使用说明' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '联系学生流程' })).toBeInTheDocument();
  });
});
