import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssistantPanel from '../AssistantPanel';

let assistant;

vi.mock('../../../context/AssistantContext', () => ({
  useAssistant: () => assistant,
}));

function state(toolCall, oneTimeResults = {}) {
  return {
    activeSessionId: 'session-1',
    sessions: [{ id: 'session-1', title: '测试会话' }],
    detail: {
      messages: [
        { id: 1, role: 'user', content: '执行操作', created_at: '2026-07-14 01:00:00' },
      ],
      tool_calls: toolCall ? [toolCall] : [],
    },
    loading: false,
    sending: false,
    error: '',
    oneTimeResults,
    maximized: false,
    setMaximized: vi.fn(),
    selectSession: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    approveToolCall: vi.fn().mockResolvedValue({}),
    rejectToolCall: vi.fn().mockResolvedValue({}),
  };
}

function pendingCall(risk = 'write') {
  return {
    id: 'call-1',
    tool_name: risk === 'destructive' ? 'cleanup_duplicate_phones' : 'mark_students_invalid',
    tool_label: risk === 'destructive' ? '清洗重复号码' : '标记学生无效',
    risk_level: risk,
    status: 'pending_confirmation',
    preview: {
      summary: risk === 'destructive' ? '清理 1 个重复组，影响 3 名学生' : '将 1 名学生标记为无效',
      items: [{ id: 12, name: '张三', old_status: '已报名', new_status: '无效', reason: '上高中' }],
    },
    approval_token: 'signed-token',
    confirmation_phrase: risk === 'destructive' ? '确认执行清洗重复号码3条' : '',
    created_at: '2026-07-14 01:00:01',
  };
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    assistant = state(null);
  });

  it('renders bold text, inline code and bullets without exposing markdown markers', () => {
    assistant = state(null);
    assistant.detail.messages[0].content = '查询结果：\n- **可分配**：`0` 人';
    render(<AssistantPanel />);

    const bold = screen.getByText('可分配');
    const code = screen.getByText('0');
    expect(bold.tagName).toBe('STRONG');
    expect(code.tagName).toBe('CODE');
    expect(screen.queryByText(/\*\*可分配\*\*/)).not.toBeInTheDocument();
  });

  it('adds phone safe-area padding to the overlay header and composer', () => {
    render(<AssistantPanel />);
    const textarea = screen.getByRole('textbox', { name: '给 AI 助手的消息' });
    const form = textarea.closest('form');
    const header = screen.getByRole('combobox', { name: '助手会话' }).closest('header');

    expect(header.className).toContain('pt-[env(safe-area-inset-top)]');
    expect(form.className).toContain('pb-[calc(env(safe-area-inset-bottom)+0.75rem)]');
  });

  it('shows a write preview and executes after one confirmation', async () => {
    const user = userEvent.setup();
    assistant = state(pendingCall());
    render(<AssistantPanel />);

    expect(screen.getByText('将 1 名学生标记为无效')).toBeInTheDocument();
    expect(screen.getByText(/已报名 → 无效/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认执行' }));
    expect(assistant.approveToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call-1' }),
      '',
    );
  });

  it('requires the exact phrase for destructive execution', async () => {
    const user = userEvent.setup();
    assistant = state(pendingCall('destructive'));
    render(<AssistantPanel />);

    await user.click(screen.getByRole('button', { name: '确认执行' }));
    const dialog = screen.getByRole('dialog');
    const finalButton = screen.getAllByRole('button', { name: '确认执行' }).at(-1);
    expect(dialog).toBeInTheDocument();
    expect(finalButton).toBeDisabled();
    await user.type(screen.getByLabelText('确认执行清洗重复号码3条'), '确认执行清洗重复号码3条');
    expect(finalButton).toBeEnabled();
    await user.click(finalButton);
    expect(assistant.approveToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call-1' }),
      '确认执行清洗重复号码3条',
    );
  });

  it('shows an approved password only from the one-time response state', () => {
    const call = { ...pendingCall(), status: 'executed', preview: {}, created_at: '2026-07-14 01:00:01' };
    assistant = state(call, { 'call-1': { new_password: 'one-time-secret' } });
    render(<AssistantPanel />);
    expect(screen.getByText('one-time-secret')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制一次性密码' })).toBeInTheDocument();
  });
});
