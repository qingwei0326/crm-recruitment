import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import { useConfirm, usePrompt } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { emptyStudentForm } from './agentWorkUtils';

// 新的 hooks
import useAgentWorkState from '../../hooks/useAgentWorkState';
import useAgentStudents from '../../hooks/useAgentStudents';
import useAgentDial from '../../hooks/useAgentDial';
import useAgentDetail from '../../hooks/useAgentDetail';
import useAgentFollowing from '../../hooks/useAgentFollowing';

// Extracted components
import AgentWorkDesktop from './AgentWorkDesktop';
import AgentWorkMobile from './AgentWorkMobile';
import StudentCreateModal from './StudentCreateModal';
import SettingsModal from './desktop/SettingsModal';
import DialResultModal from './desktop/DialResultModal';
import HelpModal from '../../components/HelpModal';

export default function AgentWork() {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();

  // 状态管理
  const { state, actions } = useAgentWorkState();

  // 学生列表管理
  const {
    students,
    filteredStudents,
    sortedStudents,
    filteredStats,
    current,
    fetchToday,
    updateStatus,
    updateIntentById,
    updateStage,
    updateScore,
    toggleNeedHelp,
    handleCreate,
  } = useAgentStudents({ state, actions, toast });

  // 拨号管理
  const {
    handleDial,
    handleDialModalStatus,
    handleDialModalIntent,
    handleDialModalFollowUp,
    handleDialModalClose,
  } = useAgentDial({
    state,
    actions,
    current,
    students,
    toast,
    confirm,
    prompt,
    updateIntentById,
  });

  // 详情面板管理
  const {
    loadDetail,
    updateDetailField,
    addNote,
    addFollowUp,
    addVisit,
    openAiPanel,
  } = useAgentDetail({ state, actions, students, toast });

  // 跟进管理
  const { fetchFollowing } = useAgentFollowing({
    state, actions, user, toast,
  });

  // 导航
  const prev = () => {
    if (state.currentIdx > 0) actions.setCurrentIdx(state.currentIdx - 1);
  };
  const next = () => {
    if (state.currentIdx < filteredStudents.length - 1) actions.setCurrentIdx(state.currentIdx + 1);
  };

  // 时限类提醒已暂时关闭，保留 prop 以兼容桌面/移动布局。
  const backlogBanner = null;

  // Modals
  const modals = (
    <>
      {state.create.show && (
        <StudentCreateModal
          student={state.create.student || emptyStudentForm}
          setStudent={(s) => actions.setCreate({ student: s })}
          error={state.create.error}
          onClose={() => actions.toggleCreate(false)}
          onSubmit={() => handleCreate(state.create.student || emptyStudentForm)}
        />
      )}
      <SettingsModal
        show={state.settings.show}
        onClose={() => actions.toggleSettings(false)}
        tokenInput={state.settings.tokenInput}
        setTokenInput={(v) => actions.setSettings({ tokenInput: v })}
        tokenSaving={state.settings.tokenSaving}
        setTokenSaving={(v) => actions.setSettings({ tokenSaving: v })}
        tokenMsg={state.settings.tokenMsg}
        setTokenMsg={(v) => actions.setSettings({ tokenMsg: v })}
      />
      <DialResultModal
        dialModal={state.dial.modal}
        onStatusSelect={handleDialModalStatus}
        onIntentSelect={handleDialModalIntent}
        onFollowUpSelect={handleDialModalFollowUp}
        onClose={handleDialModalClose}
      />
      {state.ui.helpOpen && (
        <HelpModal
          isOpen={state.ui.helpOpen}
          onClose={() => actions.toggleHelp(false)}
          role="agent"
        />
      )}
    </>
  );

  // 共享 props
  const sharedProps = {
    user,
    dark,
    toggleTheme,
    logout,
    // 数据
    students,
    filteredStudents,
    sortedStudents,
    filteredStats,
    schoolGroups: state.schoolGroups,
    currentIdx: state.currentIdx,
    setCurrentIdx: actions.setCurrentIdx,
    current,
    // 筛选
    selectedSchool: state.filters.selectedSchool,
    setSelectedSchool: (v) => actions.setFilter('selectedSchool', v),
    selectedStage: state.filters.selectedStage,
    setSelectedStage: (v) => actions.setFilter('selectedStage', v),
    selectedIntent: state.filters.selectedIntent,
    setSelectedIntent: (v) => actions.setFilter('selectedIntent', v),
    scoreRange: state.filters.scoreRange,
    setScoreRange: (v) => actions.setFilter('scoreRange', v),
    selectedStatus: state.filters.selectedStatus,
    setSelectedStatus: (v) => actions.setFilter('selectedStatus', v),
    searchQuery: state.filters.searchQuery,
    setSearchQuery: (v) => actions.setFilter('searchQuery', v),
    sortConfig: state.sortConfig,
    setSortConfig: actions.setSortConfig,
    expandedId: state.ui.expandedId,
    setExpandedId: actions.setExpandedId,
    // 视图
    viewTab: state.ui.viewTab,
    setViewTab: actions.setViewTab,
    showMenu: state.ui.showMenu,
    setShowMenu: actions.toggleMenu,
    // 详情
    showDetail: state.detail.show,
    setShowDetail: actions.toggleDetail,
    detailStudent: state.detail.student,
    detailLoading: state.detail.loading,
    detailError: state.detail.error,
    detailNotes: state.detail.notes,
    detailCalls: state.detail.calls,
    detailFollowUps: state.detail.followUps,
    detailVisits: state.detail.visits,
    detailIntentTimeline: state.detail.intentTimeline,
    detailNotesError: state.detail.notesError,
    hasAnalysis: state.detail.hasAnalysis,
    // AI
    showAi: state.ai.show,
    setShowAi: actions.toggleAi,
    activeStudent: state.ai.activeStudent,
    // 备注
    noteText: state.noteText,
    setNoteText: actions.setNoteText,
    // 消息
    actionMsg: state.ui.actionMsg,
    // 拨号
    dialCheckByStudent: state.dial.checkByStudent,
    lockedStudentId: state.dial.lockedStudentId,
    // 跟进
    followingData: state.following.data,
    followingLoading: state.following.loading,
    backlogBanner,
    // Handlers
    handleDial,
    updateStatus,
    updateStage,
    updateIntentById,
    addNote: (id) => addNote(id, state.noteText),
    openAiPanel,
    updateScore,
    loadDetail,
    updateDetailField,
    prev,
    next,
    toggleNeedHelp,
    fetchFollowing,
    fetchToday,
    // 模态框
    modals,
    // Actions
    onHelpOpen: () => actions.toggleHelp(true),
    onAddStudent: () => actions.toggleCreate(true),
    onShowSettings: () => actions.toggleSettings(true),
  };

  // ═══════════════════════════════════════════════
  // MOBILE LAYOUT
  // ═══════════════════════════════════════════════
  if (isMobile) {
    return <AgentWorkMobile {...sharedProps} />;
  }

  // ═══════════════════════════════════════════════
  // DESKTOP LAYOUT
  // ═══════════════════════════════════════════════
  return <AgentWorkDesktop {...sharedProps} />;
}
