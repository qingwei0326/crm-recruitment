import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { notifyOutcomeSaved, UNDO_TOAST_MS } from '../outcomeUndo';

vi.mock('../../api', () => ({ default: { post: vi.fn() } }));

function makeToast() {
  return { success: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifyOutcomeSaved', () => {
  it('shows a plain toast when the mark cannot be undone', () => {
    const toast = makeToast();
    notifyOutcomeSaved(toast, { message: '已标记', studentId: 7, undoable: false });
    expect(toast.success).toHaveBeenCalledWith('已标记');
  });

  it('adds a long-lived undo button after a first mark', () => {
    const toast = makeToast();
    notifyOutcomeSaved(toast, { message: '已标记', studentId: 7, undoable: true });
    const [message, options] = toast.success.mock.calls[0];
    expect(message).toBe('已标记');
    expect(options.duration).toBe(UNDO_TOAST_MS);
    expect(options.action.label).toBe('撤销');
  });

  it('calls the undo endpoint and reports the lead back in the call queue', async () => {
    api.post.mockResolvedValue({ data: { code: 0, data: { id: 7, status: '未联系' } } });
    const toast = makeToast();
    const onUndone = vi.fn();
    notifyOutcomeSaved(toast, { message: '已标记', studentId: 7, undoable: true, onUndone });

    await toast.success.mock.calls[0][1].action.onClick();

    expect(api.post).toHaveBeenCalledWith('/students/7/undo-outcome');
    expect(toast.success).toHaveBeenLastCalledWith('已撤销，学生回到「待拨打」');
    expect(onUndone).toHaveBeenCalledWith({ id: 7, status: '未联系' });
  });

  it('shows the server reason when the undo is refused', async () => {
    api.post.mockResolvedValue({ data: { code: 1, msg: '只能撤销 30 分钟内的标记' } });
    const toast = makeToast();
    const onUndone = vi.fn();
    notifyOutcomeSaved(toast, { message: '已标记', studentId: 7, undoable: true, onUndone });

    await toast.success.mock.calls[0][1].action.onClick();

    expect(toast.error).toHaveBeenCalledWith('只能撤销 30 分钟内的标记');
    expect(onUndone).not.toHaveBeenCalled();
  });

  it('shows the reason from a rejected request too', async () => {
    api.post.mockRejectedValue({ response: { data: { msg: '没有可以撤销的标记' } } });
    const toast = makeToast();
    notifyOutcomeSaved(toast, { message: '已标记', studentId: 7, undoable: true });

    await toast.success.mock.calls[0][1].action.onClick();

    expect(toast.error).toHaveBeenCalledWith('没有可以撤销的标记');
  });

  it('does nothing without a toast context', () => {
    expect(() => notifyOutcomeSaved(undefined, { message: 'x', studentId: 1, undoable: true })).not.toThrow();
  });
});
