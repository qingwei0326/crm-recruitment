import { useCallback } from 'react';
import api from '../api';

/**
 * 封装拨号流程：
 *   1) GET /api/calls/check 查 24h 通话次数
 *   2) count >= 3 时弹 confirm 让用户确认
 *   3) GET /api/students/phone/{id} 拿明文电话；403 时 alert detail
 *   4) 成功 → window.location.href = `tel:${phone}`
 *
 * dial(studentId, options?) options: { contactKey?: 'guardian' | 'guardian2', onSuccess?, onError? }
 * checkDup(studentId) → { count, last_call_at, message } | null
 */
export default function useDialFlow() {
  const checkDup = useCallback(async (studentId) => {
    try {
      const r = await api.get('/calls/check', {
        params: { student_id: studentId, within_hours: 24 },
      });
      if (r.data.code === 0) return r.data.data;
    } catch {
      // 静默：检查失败不应阻塞拨号
    }
    return null;
  }, []);

  const dial = useCallback(
    async (studentId, options = {}) => {
      const { contactKey = 'guardian', onSuccess, onError } = options;

      // 1) 查 24h 拨打次数
      const check = await checkDup(studentId);
      const count = check?.count ?? 0;
      if (count >= 3) {
        const ok = window.confirm(
          `该学生 24h 内已被拨打 ${count} 次（来自任意坐席），确认继续？`,
        );
        if (!ok) return { ok: false, reason: 'cancelled' };
      }

      // 2) 拿明文电话
      let phone = '';
      try {
        const r = await api.get(`/students/phone/${studentId}`);
        if (r.data.code === 0) {
          phone =
            contactKey === 'guardian2'
              ? r.data.data.guardian2_phone || ''
              : r.data.data.guardian_phone || '';
        }
      } catch (err) {
        const detail =
          err?.response?.data?.detail || err?.response?.data?.msg || '获取电话失败';
        if (err?.response?.status === 403) {
          alert(detail);
        } else {
          alert(detail);
        }
        onError && onError(detail);
        return { ok: false, reason: 'phone_error', message: detail };
      }
      if (!phone) {
        const msg = '该联系人没有电话';
        alert(msg);
        onError && onError(msg);
        return { ok: false, reason: 'no_phone', message: msg };
      }

      // 3) 跳起拨号
      window.location.href = `tel:${phone}`;
      onSuccess && onSuccess(phone);
      // 4) 拨号窗口已记 DialLog；刷新检查（异步，不阻塞）
      checkDup(studentId);
      return { ok: true, phone };
    },
    [checkDup],
  );

  return { dial, checkDup };
}
