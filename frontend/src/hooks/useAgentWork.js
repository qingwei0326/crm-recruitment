import { useCallback, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import useAgentWorkState from './useAgentWorkState';
import useAgentStudents from './useAgentStudents';
import useAgentDetail from './useAgentDetail';
import useAgentFollowing from './useAgentFollowing';
import useFlashMessage from './useFlashMessage';

const STATUS_WITH_INTENT = ['已联系', '待回访'];

/**
 * 统一的 AgentWork hook — 组合所有子 hook，补齐 AgentWork.jsx 中的剩余逻辑。
 *
 * 返回值 = AgentWorkDesktop / AgentWorkMobile 需要的全部 props。
 */
export default function useAgentWork() {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();

  // ── 1. 状态管理 ──
  const { state, actions } = useAgentWorkState();

  // ── 2. 学生列表 + 筛选 + CRUD ──
  const {
    students,
    filteredStudents,
    sortedStudents,
    filteredStats,
    current,
    fetchToday,
    updateStatus: updateStatusBase,
    updateIntentById: updateIntentByIdBase,
    updateStage,
    updateScore,
    toggleNeedHelp,
    handleCreate: handleCreateBase,
  } = useAgentStudents({ state, actions, toast });

  // ── 3. 详情面板 ──
  const {
    loadDetail,
    updateDetailField,
    addNote: addNoteBase,
    addFollowUp: addFollowUpBase,
    addVisit: addVisitBase,
    openAiPanel,
  } = useAgentDetail({ state, actions, students, toast });

  // ── 4. 跟进中 + 积压提醒 ──
  const { fetchFollowing, dismissBacklogAlert } = useAgentFollowing({
    state, actions, user, toast,
  });

  // ── flashMsg hook（替代 11 处 setTimeout+setActionMsg 重复）──
  const flashMsg = useFlashMessage(actions);

  // ── 便捷别名 ──
  const { noteText, followUpDate } = state;
  const { visit } = state;

  // ── 6. 剩余副作用 ──

  // 拨号返回后自动弹窗（兼容移动端从 tel: 返回）
  const tryLoadPendingDial = useCallback(() => {
    if (state.dial.modal) return; // 正在处理一通结果时不覆盖
    const raw = sessionStorage.getItem('pendingDial');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        sessionStorage.removeItem('pendingDial');
        actions.setDialModal(data);
      } catch { sessionStorage.removeItem('pendingDial'); }
    }
  }, [state.dial.modal, actions]);

  useEffect(() => {
    tryLoadPendingDial(); // 初次挂载
    const onVisibility = () => { if (document.visibilityState === 'visible') tryLoadPendingDial(); };
    const onFocus = () => tryLoadPendingDial();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [tryLoadPendingDial]);

  // 拨号检查：跟随当前展示学生的 id 变化
  useEffect(() => {
    if (current) {
      api.get('/calls/check', { params: { student_id: current.id, within_hours: 24 } }).then((r) => {
        if (r.data.code === 0) actions.setDialCheck(current.id, r.data.data);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // ── 7. 导航 ──
  const prev = useCallback(() => {
    if (state.currentIdx > 0) actions.setCurrentIdx(state.currentIdx - 1);
  }, [state.currentIdx, actions]);

  const next = useCallback(() => {
    if (state.currentIdx < filteredStudents.length - 1) actions.setCurrentIdx(state.currentIdx + 1);
  }, [state.currentIdx, filteredStudents.length, actions]);

  // ── 8. 状态更新 ──
  const updateStatus = useCallback(async (id, s) => {
    await updateStatusBase(id, { status: s });
  }, [updateStatusBase]);

  // ── 9. 意向更新（同步详情面板）──
  const updateIntentById = useCallback(async (id, level) => {
    await updateIntentByIdBase(id, level);
  }, [updateIntentByIdBase]);

  // ── 10. 创建学生（包装 buildStudentPayload）──
  const handleCreate = useCallback(async (newStudent) => {
    await handleCreateBase(newStudent);
  }, [handleCreateBase]);

  // ── 11. 备注 / 回访 / 到访（适配子组件调用签名）──
  const addNote = useCallback((targetId) => {
    addNoteBase(targetId, noteText);
  }, [addNoteBase, noteText]);

  const addFollowUp = useCallback(async () => {
    await addFollowUpBase(current, followUpDate);
  }, [addFollowUpBase, current, followUpDate]);

  const addVisit = useCallback(async () => {
    await addVisitBase(current, visit);
  }, [addVisitBase, current, visit]);

  // ── 12. 拨号结果弹窗流程 ──
  const handleDialModalStatus = useCallback(async (s) => {
    if (!state.dial.modal) return;
    try {
      await updateStatus(state.dial.modal.studentId, s);
      if (STATUS_WITH_INTENT.includes(s)) {
        actions.setDialModal({ ...state.dial.modal, status: s, showIntent: true });
      } else {
        actions.setDialModal(null);
        next();
      }
    } catch (e) {
      console.error('handleDialModalStatus failed:', e);
    }
  }, [state.dial.modal, updateStatus, actions, next]);

  const handleDialModalIntent = useCallback(async (level) => {
    if (!state.dial.modal) return;
    await updateIntentById(state.dial.modal.studentId, level);
    flashMsg('意向等级已更新');
    actions.setDialModal(null);
    next();
  }, [state.dial.modal, updateIntentById, flashMsg, actions, next]);

  const handleDialModalFollowUp = useCallback(async (date) => {
    if (!state.dial.modal) return;
    if (date) {
      try {
        await api.post('/follow-ups', {
          student_id: state.dial.modal.studentId,
          follow_up_date: date.length === 16 ? date + ':00' : date,
        });
        flashMsg('回访提醒已设置');
      } catch (e) {
        toast?.error(
          e?.response?.data?.detail || e?.response?.data?.msg || e?.message || '操作失败'
        );
      }
    }
    actions.setDialModal(null);
    next();
  }, [state.dial.modal, flashMsg, actions, next, toast]);

  // ── 13. 拨号主流程 ──
  const refreshDialCheck = useCallback(async (id) => {
    try {
      const r = await api.get('/calls/check', { params: { student_id: id, within_hours: 24 } });
      if (r.data.code === 0) {
        actions.setDialCheck(id, r.data.data);
        return r.data.data;
      }
    } catch { /* 静默 */ }
    return null;
  }, [actions]);

  const handleDial = useCallback(async (id, contactKey) => {
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
    if (!phone) { toast?.error('该联系人没有电话'); return; }
    const dialStudent = students.find((s) => s.id === id);
    sessionStorage.setItem('pendingDial', JSON.stringify({
      studentId: id,
      studentName: dialStudent?.name || '未知',
    }));
    window.location.href = `tel:${phone}`;
    actions.setLockedStudent(id);
    refreshDialCheck(id);
  }, [refreshDialCheck, confirm, students, actions, toast]);

  // ── 14. 返回所有 props ──
  return {
    // Context
    user, logout, dark, toggleTheme,

    // 状态
    state,
    actions,
    students,
    filteredStudents,
    sortedStudents,
    filteredStats,
    schoolGroups: state.schoolGroups,
    current,
    currentIdx: state.currentIdx,
    lockedStudentId: state.dial.lockedStudentId,
    dialCheckByStudent: state.dial.checkByStudent,
    noteText,
    actionMsg: state.ui.actionMsg,

    // 筛选
    selectedSchool: state.filters.selectedSchool,
    selectedStage: state.filters.selectedStage,
    selectedIntent: state.filters.selectedIntent,
    scoreRange: state.filters.scoreRange,

    // UI 状态
    viewTab: state.ui.viewTab,
    showMenu: state.ui.showMenu,
    expandedId: state.ui.expandedId,
    showDetail: state.detail.show,
    detailStudent: state.detail.student,
    detailLoading: state.detail.loading,
    detailError: state.detail.error,
    detailNotes: state.detail.notes,
    detailNotesError: state.detail.notesError,
    noteIdx: state.detail.noteIdx,
    hasAnalysis: state.detail.hasAnalysis,
    showAi: state.ai.show,
    activeStudent: state.ai.activeStudent,
    showCreate: state.create.show,
    createErr: state.create.error,
    showSettings: state.settings.show,
    helpOpen: state.ui.helpOpen,
    backlogAlert: state.backlogAlert,
    followingData: state.following.data,
    followingLoading: state.following.loading,
    dialModal: state.dial.modal,
    sortConfig: state.sortConfig,

    // 数据操作
    fetchToday,
    fetchFollowing,
    updateStatus,
    updateIntentById,
    updateStage,
    updateScore,
    toggleNeedHelp,
    handleCreate,
    loadDetail,
    updateDetailField,
    addNote,
    addFollowUp,
    addVisit,
    openAiPanel,
    handleDial,
    refreshDialCheck,
    dismissBacklogAlert,
    prev,
    next,
    flashMsg,

    // 拨号弹窗流程
    handleDialModalStatus,
    handleDialModalIntent,
    handleDialModalFollowUp,
  };
}
