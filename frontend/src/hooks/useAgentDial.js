import { useCallback, useEffect, useRef } from 'react';
import api from '../api';
import { getApiErrorMessage } from '../utils';
import logger from '../utils/logger';

/**
 * 管理拨号相关逻辑
 */
export default function useAgentDial({ state, actions, current, students, toast, confirm, prompt }) {
  // 用 ref 缓存 lastFetchedId 防止重复请求
  const lastFetchedIdRef = useRef(null);

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

  // 预测和拨号检查 - 用 ref 防止重复请求
  useEffect(() => {
    const studentId = current?.id;
    if (!studentId || studentId === lastFetchedIdRef.current) return;
    lastFetchedIdRef.current = studentId;

    api.get(`/stats/predict-conversion/${studentId}`).then((r) => {
      if (r.data.code === 0) actions.setPrediction(r.data.data);
    }).catch((e) => { logger.error('转化预测失败:', e); actions.setPrediction(null); });

    api.get('/calls/check', { params: { student_id: studentId, within_hours: 24 } }).then((r) => {
      if (r.data.code === 0) actions.setDialCheck(studentId, r.data.data);
    }).catch((e) => logger.error('拨号检查失败:', e));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 处理拨号
  const handleDial = useCallback(async (contactKey, id) => {
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
    }));
    window.location.href = `tel:${phone}`;
    actions.setLockedStudent(id);
    refreshDialCheck(id);
  }, [refreshDialCheck, students, actions, toast, confirm]);

  // 处理拨号结果弹窗 - 状态选择
  const handleDialModalStatus = useCallback(async (s) => {
    const modal = state.dial.modal;
    if (!modal) return;

    let status = typeof s === 'string' ? s : s.status;
    let invalidReason = typeof s === 'object' ? s.invalid_reason : undefined;

    if (status === '空号') {
      status = '无效';
      invalidReason = '空号';
    }

    if (invalidReason) {
      try {
        await api.put(`/students/${modal.studentId}`, { status, invalid_reason: invalidReason });
        actions.updateStudent(modal.studentId, { status });
        actions.setActionMsg('状态已更新');
        setTimeout(() => actions.setActionMsg(''), 2000);
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
          await api.put(`/students/${modal.studentId}`, { status, invalid_reason: reason });
          actions.updateStudent(modal.studentId, { status });
          actions.setActionMsg('状态已更新');
          setTimeout(() => actions.setActionMsg(''), 2000);
        } catch (e) {
          toast?.error('更新状态失败: ' + getApiErrorMessage(e));
        }
      } else {
        try {
          await api.put(`/students/${modal.studentId}`, { status });
          actions.updateStudent(modal.studentId, { status });
          actions.setActionMsg('状态已更新');
          setTimeout(() => actions.setActionMsg(''), 2000);
        } catch (e) {
          toast?.error('更新状态失败: ' + getApiErrorMessage(e));
        }
      }
    }

    if (status === '非常有意向' || status === '意向了解加微' || status === '未接') {
      actions.setDialModal({ ...modal, status, showIntent: true });
    } else {
      actions.setDialModal(null);
    }
  }, [state.dial.modal, actions, toast, prompt]);

  // 处理拨号结果弹窗 - 意向选择
  const handleDialModalIntent = useCallback(async (level) => {
    const modal = state.dial.modal;
    if (!modal) return;
    await updateIntentById(modal.studentId, level);
    actions.setActionMsg('意向等级已更新');
    setTimeout(() => actions.setActionMsg(''), 2000);
    actions.setDialModal(null);
  }, [state.dial.modal, actions]);

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
    actions.setDialModal(null);
  }, [state.dial.modal, actions, toast]);

  // 检查待处理的拨号
  useEffect(() => {
    const raw = sessionStorage.getItem('pendingDial');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        sessionStorage.removeItem('pendingDial');
        actions.setDialModal(data);
      } catch {
        sessionStorage.removeItem('pendingDial');
      }
    }
  }, [actions]);

  return {
    handleDial,
    handleDialModalStatus,
    handleDialModalIntent,
    handleDialModalFollowUp,
    refreshDialCheck,
  };
}
