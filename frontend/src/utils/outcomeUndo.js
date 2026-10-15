import api from '../api';
import { getApiErrorMessage } from '../utils';

// How long the "撤销" button stays on screen: long enough to notice a mis-tap.
export const UNDO_TOAST_MS = 10000;

// Shows the "saved" toast. When the server says this was the first mark on a lead
// (`outcome_undoable` in the save response), the toast also carries an undo button that
// puts the lead back in the call queue.
export function notifyOutcomeSaved(toast, { message, studentId, undoable, onUndone }) {
  if (!toast) return;
  if (!undoable) {
    toast.success(message);
    return;
  }
  toast.success(message, {
    duration: UNDO_TOAST_MS,
    action: {
      label: '撤销',
      onClick: async () => {
        try {
          const response = await api.post(`/students/${studentId}/undo-outcome`);
          if (response.data?.code !== undefined && response.data.code !== 0) {
            throw new Error(response.data.msg || '撤销失败');
          }
          toast.success('已撤销，学生回到「待拨打」');
          if (onUndone) onUndone(response.data?.data || {});
        } catch (error) {
          toast.error(getApiErrorMessage(error));
        }
      },
    },
  });
}
