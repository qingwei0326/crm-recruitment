import { useCallback } from 'react';
import api from '../api';
import { useToast } from '../components/Toast';
import { readPendingDial, savePendingDial } from '../dialSession';

/**
 * 封装拨号流程：
 *   1) GET /api/students/phone/{id} 拿明文电话；403 时提示 detail
 *   2) 成功 → window.location.href = `tel:${phone}`
 *
 * 拨号不再受 24 小时频次或拨号时间窗口限制。
 *
 * dial(studentId, options?) options: { contactKey?: 'guardian' | 'guardian2', studentName?, onSuccess?, onError? }
 *
 * 拨号成功跳起 tel: 前，会把 { studentId, studentName, dialStartedAt } 写入 sessionStorage('pendingDial')，
 * 供话务员打完电话返回 App 时由 <MobileDialResult> 弹窗读取，更新联系状况(已联系/待回访/…)。
 */
export default function useDialFlow() {
  const toast = useToast();

  const dial = useCallback(
    async (studentId, options = {}) => {
      const { contactKey = 'guardian', studentName = '', onSuccess, onError } = options;

      // 拿明文电话
      let phone = '';
      let dialLogId = null;
      const existingDial = readPendingDial();
      const reusableDialLogId = Number(existingDial?.studentId) === Number(studentId)
        ? existingDial?.dialLogId
        : null;
      try {
        const url = `/students/phone/${studentId}`;
        const r = reusableDialLogId
          ? await api.get(url, { params: { dial_log_id: reusableDialLogId } })
          : await api.get(url);
        if (r.data.code === 0) {
          dialLogId = r.data.data.dial_log_id ?? null;
          phone =
            contactKey === 'guardian2'
              ? r.data.data.guardian2_phone || ''
              : r.data.data.guardian_phone || '';
        }
      } catch (err) {
        const detail =
          err?.response?.data?.detail || err?.response?.data?.msg || '获取电话失败';
        toast?.error(detail);
        onError && onError(detail);
        return { ok: false, reason: 'phone_error', message: detail };
      }
      if (!phone) {
        const msg = '该联系人没有电话';
        toast?.error(msg);
        onError && onError(msg);
        return { ok: false, reason: 'no_phone', message: msg };
      }

      // 3) 跳起拨号。先存拨号上下文：打完电话返回 App 时弹“选择处理结果”更新联系状况
      savePendingDial({
        studentId,
        studentName,
        dialLogId,
        dialStartedAt: reusableDialLogId && reusableDialLogId === dialLogId
          ? existingDial.dialStartedAt
          : Date.now(),
      });
      window.location.href = `tel:${phone}`;
      onSuccess && onSuccess(phone);
      return { ok: true, phone };
    },
    [toast],
  );

  return { dial };
}
