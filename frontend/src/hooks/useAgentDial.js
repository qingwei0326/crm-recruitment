import { useCallback, useEffect, useRef } from 'react';
import api from '../api';
import { getApiErrorMessage } from '../utils';
import logger from '../utils/logger';
import { resolveOperatorResult } from '../operatorResultPolicy';

const INTENT_STEP_STATUSES = ['非常有意向', '意向了解加微', '已联系', '待回访'];

/**
 * 管理拨号相关逻辑
 */
export default function useAgentDial({
  state,
  actions,
  current,
  students,
  toast,
  confirm,
  prompt,
  updateIntentById,
}) {
  // 用 ref 缓存 lastFetchedId 防止重复请求
  const lastFetchedIdRef = useRef(null);
  const recordedDialRef = useRef(null);
  const dialingRef = useRef(new Set());

  const recordDialDurationOnce = useCallback((modal) => {
    if (!modal?.studentId || !modal?.dialStartedAt) return;
    const duration = Math.round((Date.now() - modal.dialStartedAt) / 1000);
    if (duration <= 0) return;
    const key = `${modal.studentId}:${modal.dialStartedAt}`;
    if (recordedDialRef.current === key) return;
    recordedDialRef.current = key;
    api.put('/students/dial-duration', null, {
      params: { student_id: modal.studentId, duration_seconds: duration },
    }).catch((e) => logger.error('记录通话时长失败:', e));
  }, []);

  // 加载拨号检查
  const refreshDialCheck = useCallback(async (id) => {
    try {
      const r = await api.get('/calls/check', { params: { student_id: id, within_hours: 24 } });
      if (r.data.code === 0) {
        actions.setDialCheck(id, r.data.data);
        return r.data.data;
      }
    } catch (e) { logger.error('拨号检查失败:', e); }
    return null;
  }, [actions]);

  // 拨号检查 - 用 ref 防止重复请求
  useEffect(() => {
    const studentId = current?.id;
    if (!studentId || studentId === lastFetchedIdRef.current) return;
    lastFetchedIdRef.current = studentId;

    api.get('/calls/check', { params: { student_id: studentId, within_hours: 24 } }).then((r) => {
      if (r.data.code === 0) actions.setDialCheck(studentId, r.data.data);
    }).catch((e) => logger.error('拨号检查失败:', e));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 处理拨号
  const handleDial = useCallback(async (contactKey, id) => {
    const dialKey = `${id}:${contactKey}`;
    if (dialingRef.current.has(dialKey)) return;
    dialingRef.current.add(dialKey);
    try {
      const check = await refreshDialCheck(id);
      const count = check?.count ?? 0;
      if (count >= 3) {
        const ok = await confirm({
          title: '拨号频次提醒',
          message: `该学生 24h 内已被拨打 ${count} 次（来自任意坐席），确认继续？`,
          confirmText: '仍要拨打',
          tone: 'danger',
        });
        if (!ok) return;
      }

      let phone = '';
      try {
        const r = await api.get(`/students/phone/${id}`);
        if (r.data.code === 0) {
          phone = contactKey === 'guardian2'
            ? r.data.data.guardian2_phone || ''
            : r.data.data.guardian_phone || '';
        }
      } catch (err) {
        if (err?.response?.status === 403) {
          toast?.error(err.response.data?.detail || '当前不允许拨号');
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
      sessionStorage.setItem('pendingDial', JSON.stringify({
        studentId: id,
        studentName: dialStudent?.name || '未知',
        dialStartedAt: Date.now(),
      }));
      window.location.href = `tel:${phone}`;
      actions.setLockedStudent(id);
      refreshDialCheck(id);
    } finally {
      setTimeout(() => {
        dialingRef.current.delete(dialKey);
      }, 1500);
    }
  }, [refreshDialCheck, students, actions, toast, confirm]);

  // 处理拨号结果弹窗 - 状态选择
  const handleDialModalStatus = useCallback(async (s) => {
    const modal = state.dial.modal;
    if (!modal) return;

    let { status, invalidReason, fixedInvalid } = resolveOperatorResult(s);
    const needsIntentStep = INTENT_STEP_STATUSES.includes(status);
    let saved = false;

    if (invalidReason) {
      try {
        const res = await api.put(`/students/${modal.studentId}`, { status, invalid_reason: invalidReason });
        const updated = res.data?.data || {};
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
        invalidReason = reason;
        try {
          const res = await api.put(`/students/${modal.studentId}`, { status, invalid_reason: reason });
          const updated = res.data?.data || {};
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
          const updated = res.data?.data || {};
          const fallbackStatusByDetail = {
            非常有意向: '已联系',
            意向了解加微: '待回访',
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
      recordDialDurationOnce(modal);
      actions.setDialModal(null);
      actions.setLockedStudent(null);
      if (status === '无效' && invalidReason && fixedInvalid) {
        actions.removeStudentFromQueue?.(modal.studentId);
      }
    }
  }, [state.dial.modal, actions, toast, prompt, confirm, recordDialDurationOnce]);

  // 处理拨号结果弹窗 - 意向选择
  const handleDialModalIntent = useCallback(async (level) => {
    const modal = state.dial.modal;
    if (!modal) return;
    await updateIntentById(modal.studentId, level);
    actions.setActionMsg('意向等级已更新');
    setTimeout(() => actions.setActionMsg(''), 2000);
    if (modal.status === '意向了解加微' || modal.status === '待回访') {
      actions.setDialModal({ ...modal, showIntent: false, showFollowUp: true });
      return;
    }
    recordDialDurationOnce(modal);
    actions.setDialModal(null);
    actions.setLockedStudent(null);
  }, [state.dial.modal, actions, updateIntentById, recordDialDurationOnce]);

  // 处理拨号结果弹窗 - 回访设置
  const handleDialModalFollowUp = useCallback(async (date) => {
    const modal = state.dial.modal;
    if (!modal) return;
    if (date) {
      try {
        await api.post('/follow-ups', {
          student_id: modal.studentId,
          follow_up_date: date.length === 16 ? date + ':00' : date,
        });
        actions.setActionMsg('回访提醒已设置');
        setTimeout(() => actions.setActionMsg(''), 2000);
      } catch (e) {
        toast?.error(getApiErrorMessage(e));
      }
    }
    recordDialDurationOnce(modal);
    actions.setDialModal(null);
    actions.setLockedStudent(null);
  }, [state.dial.modal, actions, toast, recordDialDurationOnce]);

  const handleDialModalClose = useCallback(() => {
    const modal = state.dial.modal;
    recordDialDurationOnce(modal);
    actions.setDialModal(null);
  }, [state.dial.modal, actions, recordDialDurationOnce]);

  // 检查待处理的拨号
  const tryLoadPendingDial = useCallback(() => {
    if (state.dial.modal) return;
    let raw;
    try {
      raw = sessionStorage.getItem('pendingDial');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      sessionStorage.removeItem('pendingDial');
      if (data?.studentId) {
        actions.setDialModal(data);
      }
    } catch {
      sessionStorage.removeItem('pendingDial');
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
    refreshDialCheck,
  };
}
