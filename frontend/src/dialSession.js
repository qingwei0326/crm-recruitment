import api from './api';

const PENDING_DIAL_KEY = 'pendingDial';

export function readPendingDial() {
  try {
    const raw = sessionStorage.getItem(PENDING_DIAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePendingDial(session) {
  try {
    sessionStorage.setItem(PENDING_DIAL_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingDial(dialLogId) {
  const current = readPendingDial();
  if (!current) return false;
  if (dialLogId != null && current.dialLogId !== dialLogId) return false;

  try {
    sessionStorage.removeItem(PENDING_DIAL_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function completePendingDial(studentId, fallbackSession = null) {
  const pending = readPendingDial() || fallbackSession;
  if (!pending || Number(pending.studentId) !== Number(studentId)) {
    return { completed: false, reason: 'no_match' };
  }
  if (!pending.dialStartedAt) {
    return { completed: false, reason: 'missing_start' };
  }

  const durationSeconds = Math.max(
    1,
    Math.round((Date.now() - pending.dialStartedAt) / 1000),
  );
  const params = {
    student_id: Number(studentId),
    duration_seconds: durationSeconds,
  };
  if (pending.dialLogId != null) params.dial_log_id = pending.dialLogId;

  const response = await api.put('/students/dial-duration', null, { params });
  if (response.data?.code !== 0) {
    throw new Error(response.data?.msg || '通话记录同步失败');
  }
  clearPendingDial(pending.dialLogId);
  return { completed: true };
}
