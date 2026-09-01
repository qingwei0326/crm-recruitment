import { useCallback, useEffect, useRef } from 'react';
import api from '../api';
import { completePendingDial, readPendingDial, savePendingDial } from '../dialSession';
import { getApiErrorMessage } from '../utils';
import logger from '../utils/logger';
import { resolveOperatorResult } from '../operatorResultPolicy';

const INTENT_STEP_STATUSES = ['非常有意向', '意向了解加微', '等待志愿', '已联系', '待回访'];

function successfulData(response, fallbackMessage) {
  if (response.data?.code !== undefined && response.data.code !== 0) {
    throw new Error(response.data.msg || fallbackMessage);
  }
  return response.data?.data || {};
}

/**
 * 管理拨号相关逻辑
 */
export default function useAgentDial({
  state,
  actions,
  students,
  toast,
  confirm,
  prompt,
  updateIntentById,
  onFlowComplete,
}) {
  const dialCompletionRef = useRef(null);
  const finalizedFlowKeyRef = useRef(null);
  const dialingRef = useRef(new Set());

  const completeDialOnce = useCallback((modal) => {
    if (!modal?.studentId) return Promise.resolve({ completed: false, reason: 'no_modal' });
    const key = `${modal.studentId}:${modal.dialLogId ?? ''}:${modal.dialStartedAt ?? ''}`;
    if (dialCompletionRef.current?.key === key) {
      return dialCompletionRef.current.promise;
    }

    const promise = completePendingDial(modal.studentId, modal)
      .then((result) => {
        if (!result?.completed && dialCompletionRef.current?.promise === promise) {
          dialCompletionRef.current = null;
        }
        return result;
      })
      .catch((e) => {
        if (dialCompletionRef.current?.promise === promise) {
          dialCompletionRef.current = null;
        }
        throw e;
      });
    dialCompletionRef.current = { key, promise };
    return promise;
  }, []);

  const completeDialOrNotify = useCallback(async (modal, message) => {
    try {
      const result = await completeDialOnce(modal);
      if (!result?.completed) {
        toast?.error(message);
        return false;
      }
      return true;
    } catch (e) {
      logger.error('记录通话时长失败:', e);
      toast?.error(message);
      return false;
    }
  }, [completeDialOnce, toast]);

  const finalizeSavedDial = useCallback(async (modal, message, { removeFromQueue = false } = {}) => {
    const completed = await completeDialOrNotify(modal, message);
    if (!completed) return false;

    const flowKey = `${modal.studentId}:${modal.dialLogId ?? ''}:${modal.dialStartedAt ?? ''}`;
    if (finalizedFlowKeyRef.current === flowKey) return true;
    finalizedFlowKeyRef.current = flowKey;

    actions.setDialModal(null);
    actions.setLockedStudent(null);
    if (removeFromQueue) actions.removeStudentFromQueue?.(modal.studentId);
    onFlowComplete?.({
      studentId: modal.studentId,
      removedFromQueue: removeFromQueue,
    });
    return true;
  }, [actions, completeDialOrNotify, onFlowComplete]);

  // 处理拨号
  const handleDial = useCallback(async (contactKey, id) => {
    const dialKey = `${id}:${contactKey}`;
    if (dialingRef.current.has(dialKey)) return;
    dialingRef.current.add(dialKey);
    try {
      let phone = '';
      let dialLogId = null;
      const existingDial = readPendingDial();
      const reusableDialLogId = Number(existingDial?.studentId) === Number(id)
        ? existingDial?.dialLogId
        : null;
      try {
        const url = `/students/phone/${id}`;
        const r = reusableDialLogId
          ? await api.get(url, { params: { dial_log_id: reusableDialLogId } })
          : await api.get(url);
        if (r.data.code === 0) {
          dialLogId = r.data.data.dial_log_id ?? null;
          phone = contactKey === 'guardian2'
            ? r.data.data.guardian2_phone || ''
            : r.data.data.guardian_phone || '';
        }
      } catch (err) {
        if (err?.response?.status === 403) {
          toast?.error(err.response.data?.detail || '当前无权拨号');
          return;
        }
        toast?.error(err?.response?.data?.detail || '获取电话失败');
        return;
      }

      if (!phone) {
        toast?.error('该联系人没有电话');
        return;
      }

      const dialStudent = students.find((s) => s.id === id);
      savePendingDial({
        studentId: id,
        studentName: dialStudent?.name || '未知',
        dialLogId,
        dialStartedAt: reusableDialLogId && reusableDialLogId === dialLogId
          ? existingDial.dialStartedAt
          : Date.now(),
      });
      window.location.href = `tel:${phone}`;
      actions.setLockedStudent(id);
    } finally {
      setTimeout(() => {
        dialingRef.current.delete(dialKey);
      }, 1500);
    }
  }, [students, actions, toast]);

  // 处理拨号结果弹窗 - 状态选择
  const handleDialModalStatus = useCallback(async (s) => {
    const modal = state.dial.modal;
    if (!modal) return;

    let { status, invalidReason } = resolveOperatorResult(s);
    const needsIntentStep = INTENT_STEP_STATUSES.includes(status);
    let saved = false;

    if (invalidReason) {
      try {
        const res = await api.put(`/students/${modal.studentId}`, { status, invalid_reason: invalidReason });
        const updated = successfulData(res, '更新状态失败');
        actions.updateStudent(modal.studentId, {
          status: updated.status || '无效',
          status_detail: updated.status_detail || invalidReason || '',
        });
        actions.setActionMsg('状态已更新');
        setTimeout(() => actions.setActionMsg(''), 2000);
        saved = true;
      } catch (e) {
        toast?.error('更新状态失败: ' + getApiErrorMessage(e));
      }
    } else {
      // 使用 prompt 获取无效原因
      if (status === '无效') {
        const reason = await prompt({
          title: '无效原因',
          message: '请简要说明无效原因',
          placeholder: '例如：空号 / 明确拒绝 / 已报他校 / 家长态度恶劣',
        });
        if (!reason) return;
        try {
          const res = await api.put(`/students/${modal.studentId}`, { status, invalid_reason: reason });
          const updated = successfulData(res, '更新状态失败');
          actions.updateStudent(modal.studentId, {
            status: updated.status || '无效',
            status_detail: updated.status_detail || reason,
          });
          actions.setActionMsg('状态已更新');
          setTimeout(() => actions.setActionMsg(''), 2000);
          saved = true;
        } catch (e) {
          toast?.error('更新状态失败: ' + getApiErrorMessage(e));
        }
      } else {
        if (status === '已报名') {
          const ok = await confirm({
            title: '确认报名',
            message: '确认将此学生标记为已报名？阶段也会同步更新为已报名。',
            confirmText: '确认报名',
          });
          if (!ok) return;
        }
        try {
          const res = await api.put(`/students/${modal.studentId}`, { status });
          const updated = successfulData(res, '更新状态失败');
          const fallbackStatusByDetail = {
            非常有意向: '已联系',
            意向了解加微: '待回访',
            等待志愿: '待回访',
          };
          actions.updateStudent(modal.studentId, {
            status: updated.status || fallbackStatusByDetail[status] || status,
            status_detail: updated.status_detail ?? (fallbackStatusByDetail[status] ? status : ''),
          });
          actions.setActionMsg('状态已更新');
          setTimeout(() => actions.setActionMsg(''), 2000);
          saved = true;
        } catch (e) {
          toast?.error('更新状态失败: ' + getApiErrorMessage(e));
        }
      }
    }

    if (!saved) return;

    if (needsIntentStep) {
      actions.setDialModal({ ...modal, status, showIntent: true });
    } else {
      await finalizeSavedDial(
        modal,
        '状态已保存，通话记录待同步，请重试',
        { removeFromQueue: true },
      );
    }
  }, [state.dial.modal, actions, toast, prompt, confirm, finalizeSavedDial]);

  // 处理拨号结果弹窗 - 意向选择
  const handleDialModalIntent = useCallback(async (level) => {
    const modal = state.dial.modal;
    if (!modal) return;
    const saved = await updateIntentById(modal.studentId, level);
    if (saved === false) return;
    actions.setActionMsg('意向等级已更新');
    setTimeout(() => actions.setActionMsg(''), 2000);
    if (['意向了解加微', '等待志愿', '待回访'].includes(modal.status)) {
      actions.setDialModal({ ...modal, showIntent: false, showFollowUp: true });
      return;
    }
    await finalizeSavedDial(
      modal,
      '状态已保存，通话记录待同步，请重试',
      { removeFromQueue: true },
    );
  }, [state.dial.modal, actions, updateIntentById, finalizeSavedDial]);

  // 处理拨号结果弹窗 - 回访设置
  const handleDialModalFollowUp = useCallback(async (date) => {
    const modal = state.dial.modal;
    if (!modal) return;
    if (!date) return;
    try {
      const response = await api.post('/follow-ups', {
        student_id: modal.studentId,
        follow_up_date: date.length === 16 ? date + ':00' : date,
      });
      if (response.data?.code !== undefined && response.data.code !== 0) {
        throw new Error(response.data.msg || '回访提醒保存失败');
      }
      actions.setActionMsg('回访提醒已设置');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
      return;
    }
    await finalizeSavedDial(
      modal,
      '状态已保存，通话记录待同步，请重试',
      { removeFromQueue: true },
    );
  }, [state.dial.modal, actions, toast, finalizeSavedDial]);

  const handleDialModalClose = useCallback(async () => {
    const modal = state.dial.modal;
    if (modal) {
      const completed = await completeDialOrNotify(modal, '通话记录同步失败，请重试');
      if (!completed) return;
    }
    actions.setDialModal(null);
    actions.setLockedStudent(null);
  }, [state.dial.modal, actions, completeDialOrNotify]);

  // 检查待处理的拨号
  const tryLoadPendingDial = useCallback(() => {
    if (state.dial.modal) return;
    const data = readPendingDial();
    if (data?.studentId) {
      actions.setDialModal(data);
    }
  }, [actions, state.dial.modal]);

  useEffect(() => {
    tryLoadPendingDial();
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') tryLoadPendingDial();
    };
    const focusHandler = () => tryLoadPendingDial();
    document.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('focus', focusHandler);
    window.addEventListener('pageshow', focusHandler);
    return () => {
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('focus', focusHandler);
      window.removeEventListener('pageshow', focusHandler);
    };
  }, [tryLoadPendingDial]);

  return {
    handleDial,
    handleDialModalStatus,
    handleDialModalIntent,
    handleDialModalFollowUp,
    handleDialModalClose,
  };
}
