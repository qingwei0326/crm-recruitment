import { useCallback, useEffect, useRef, useState } from 'react';

const NOTICE_DURATION_MS = 6000;

export default function useMobileDialAutoAdvance({
  enabled,
  students,
  currentStudentId,
  lockedStudentId,
  setCurrentIdx,
}) {
  const [notice, setNotice] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  const scheduleDismiss = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setNotice(null);
      timerRef.current = null;
    }, NOTICE_DURATION_MS);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!enabled || lockedStudentId != null) dismiss();
  }, [dismiss, enabled, lockedStudentId]);

  useEffect(() => {
    if (notice?.kind !== 'advanced') return;
    const currentId = Number(currentStudentId);
    const previousId = Number(notice.previousStudentId);
    const targetId = Number(notice.targetStudentId);
    if (currentId !== previousId && currentId !== targetId) dismiss();
  }, [currentStudentId, dismiss, notice]);

  const handleDialComplete = useCallback(({ studentId, removedFromQueue = false }) => {
    if (!enabled || Number(studentId) !== Number(currentStudentId)) return;

    const completedIndex = students.findIndex(
      (student) => Number(student.id) === Number(studentId),
    );
    if (completedIndex < 0) return;

    if (removedFromQueue) {
      const remainingStudent = students[completedIndex + 1]
        || students[completedIndex - 1]
        || null;
      setNotice({
        kind: 'removed',
        message: remainingStudent
          ? `已完成，继续处理 ${remainingStudent.name || '下一位学生'}`
          : '今日待拨已处理完',
        previousStudentId: null,
      });
      scheduleDismiss();
      return;
    }

    const nextStudent = students[completedIndex + 1];
    if (!nextStudent) {
      setNotice({
        kind: 'complete',
        message: '结果已保存，当前已是最后一位',
        previousStudentId: null,
      });
      scheduleDismiss();
      return;
    }

    setCurrentIdx(completedIndex + 1);
    setNotice({
      kind: 'advanced',
      message: `已进入 ${nextStudent.name || '下一位学生'}`,
      previousStudentId: studentId,
      targetStudentId: nextStudent.id,
    });
    scheduleDismiss();
  }, [currentStudentId, enabled, scheduleDismiss, setCurrentIdx, students]);

  const undo = useCallback(() => {
    if (!notice?.previousStudentId || lockedStudentId != null) return;
    const previousIndex = students.findIndex(
      (student) => Number(student.id) === Number(notice.previousStudentId),
    );
    if (previousIndex >= 0) setCurrentIdx(previousIndex);
    dismiss();
  }, [dismiss, lockedStudentId, notice, setCurrentIdx, students]);

  return {
    notice,
    handleDialComplete,
    undo,
    dismiss,
  };
}
