import { useReducer, useMemo } from 'react';

// 初始状态
const initialState = {
  // 学生列表相关
  students: [],
  stats: { total: 0, done: 0, pending: 0, follow_up: 0, progress_pct: 0 },
  schoolGroups: [],
  currentIdx: 0,

  // 筛选相关
  filters: {
    searchQuery: '',
    selectedSchool: null,
    selectedStage: null,
    selectedIntent: null,
    selectedStatus: null,
    scoreRange: { min: '', max: '' },
  },
  sortConfig: { key: 'days', direction: 'desc' },

  // 详情面板相关
  detail: {
    show: false,
    student: null,
    notes: [],
    calls: [],
    followUps: [],
    visits: [],
    intentTimeline: [],
    noteIdx: 0,
    loading: false,
    error: '',
    notesError: '',
    hasAnalysis: false,
  },

  // AI 面板相关
  ai: {
    show: false,
    activeStudent: null,
  },

  // 拨号相关
  dial: {
    modal: null,
    lockedStudentId: null,
    checkByStudent: {},
  },

  // 跟进相关
  following: {
    data: null,
    loading: false,
  },

  // 备注相关
  noteText: '',

  // 回访相关
  followUpDate: '',

  // 到访相关
  visit: {
    type: '来校参观',
    date: '',
    notes: '',
  },

  // 创建学生相关
  create: {
    show: false,
    student: null,
    error: '',
  },

  // 设置相关
  settings: {
    show: false,
    tokenInput: '',
    tokenSaving: false,
    tokenMsg: '',
  },

  // UI 状态
  ui: {
    viewTab: 'today',
    showMenu: false,
    helpOpen: false,
    actionMsg: '',
    expandedId: null,
  },

  // 时限类提醒暂时关闭；字段保留以兼容旧 action。
  backlogAlert: null,
};

// Action Types
const ActionTypes = {
  SET_STUDENTS: 'SET_STUDENTS',
  SET_STATS: 'SET_STATS',
  SET_SCHOOL_GROUPS: 'SET_SCHOOL_GROUPS',
  SET_CURRENT_IDX: 'SET_CURRENT_IDX',
  SET_FILTER: 'SET_FILTER',
  RESET_FILTERS: 'RESET_FILTERS',
  SET_SORT_CONFIG: 'SET_SORT_CONFIG',
  SET_EXPANDED_ID: 'SET_EXPANDED_ID',

  SET_DETAIL: 'SET_DETAIL',
  SET_DETAIL_LOADING: 'SET_DETAIL_LOADING',
  SET_DETAIL_ERROR: 'SET_DETAIL_ERROR',
  SET_DETAIL_NOTES: 'SET_DETAIL_NOTES',
  SET_DETAIL_NOTES_ERROR: 'SET_DETAIL_NOTES_ERROR',
  SET_NOTE_IDX: 'SET_NOTE_IDX',
  SET_HAS_ANALYSIS: 'SET_HAS_ANALYSIS',
  TOGGLE_DETAIL: 'TOGGLE_DETAIL',

  SET_AI: 'SET_AI',
  TOGGLE_AI: 'TOGGLE_AI',

  SET_DIAL_MODAL: 'SET_DIAL_MODAL',
  SET_LOCKED_STUDENT: 'SET_LOCKED_STUDENT',
  SET_DIAL_CHECK: 'SET_DIAL_CHECK',

  SET_FOLLOWING: 'SET_FOLLOWING',
  SET_FOLLOWING_LOADING: 'SET_FOLLOWING_LOADING',

  SET_NOTE_TEXT: 'SET_NOTE_TEXT',
  SET_FOLLOW_UP_DATE: 'SET_FOLLOW_UP_DATE',
  SET_VISIT: 'SET_VISIT',

  SET_CREATE: 'SET_CREATE',
  TOGGLE_CREATE: 'TOGGLE_CREATE',

  SET_SETTINGS: 'SET_SETTINGS',
  TOGGLE_SETTINGS: 'TOGGLE_SETTINGS',

  SET_UI: 'SET_UI',
  SET_VIEW_TAB: 'SET_VIEW_TAB',
  TOGGLE_MENU: 'TOGGLE_MENU',
  TOGGLE_HELP: 'TOGGLE_HELP',
  SET_ACTION_MSG: 'SET_ACTION_MSG',

  SET_BACKLOG_ALERT: 'SET_BACKLOG_ALERT',

  UPDATE_STUDENT: 'UPDATE_STUDENT',
  UPDATE_STUDENT_FIELD: 'UPDATE_STUDENT_FIELD',
  REMOVE_STUDENT_FROM_QUEUE: 'REMOVE_STUDENT_FROM_QUEUE',
};

function decrementStatsForRemovedStudent(stats, student) {
  if (!student) return stats;
  const total = Math.max((Number(stats.total) || 0) - 1, 0);
  const pending = ['未联系', '新线索'].includes(student.status)
    ? Math.max((Number(stats.pending) || 0) - 1, 0)
    : (Number(stats.pending) || 0);
  const done = Number(stats.done) || 0;
  const followUp = Number(stats.follow_up) || 0;
  return {
    ...stats,
    total,
    pending,
    done,
    follow_up: followUp,
    progress_pct: total > 0 ? Math.round(((done + followUp) / total) * 1000) / 10 : 0,
  };
}

// Reducer
function agentWorkReducer(state, action) {
  switch (action.type) {
    case ActionTypes.SET_STUDENTS:
      return { ...state, students: action.payload };

    case ActionTypes.SET_STATS:
      return { ...state, stats: action.payload };

    case ActionTypes.SET_SCHOOL_GROUPS:
      return { ...state, schoolGroups: action.payload };

    case ActionTypes.SET_CURRENT_IDX: {
      const nextIdx = typeof action.payload === 'function'
        ? action.payload(state.currentIdx)
        : action.payload;
      return { ...state, currentIdx: nextIdx };
    }

    case ActionTypes.SET_FILTER:
      return {
        ...state,
        filters: { ...state.filters, [action.key]: action.value },
        currentIdx: 0, // 筛选变化时重置索引
      };

    case ActionTypes.RESET_FILTERS:
      return {
        ...state,
        filters: initialState.filters,
        currentIdx: 0,
      };

    case ActionTypes.SET_SORT_CONFIG:
      return { ...state, sortConfig: action.payload };

    case ActionTypes.SET_EXPANDED_ID:
      return { ...state, ui: { ...state.ui, expandedId: action.payload } };

    case ActionTypes.SET_DETAIL:
      return {
        ...state,
        detail: {
          ...state.detail,
          show: true,
          student: action.payload.student ?? state.detail.student,
          notes: action.payload.notes ?? state.detail.notes,
          calls: action.payload.calls ?? state.detail.calls,
          followUps: action.payload.followUps ?? state.detail.followUps,
          visits: action.payload.visits ?? state.detail.visits,
          intentTimeline: action.payload.intentTimeline ?? state.detail.intentTimeline,
          noteIdx: action.payload.noteIdx ?? state.detail.noteIdx,
          loading: action.payload.loading ?? state.detail.loading,
          error: action.payload.error ?? state.detail.error,
          notesError: action.payload.notesError ?? state.detail.notesError,
          hasAnalysis: action.payload.hasAnalysis ?? state.detail.hasAnalysis,
        },
        ai: { ...state.ai, show: false },
      };

    case ActionTypes.SET_DETAIL_LOADING:
      return { ...state, detail: { ...state.detail, loading: action.payload } };

    case ActionTypes.SET_DETAIL_ERROR:
      return { ...state, detail: { ...state.detail, error: action.payload } };

    case ActionTypes.SET_DETAIL_NOTES:
      return { ...state, detail: { ...state.detail, notes: action.payload } };

    case ActionTypes.SET_DETAIL_NOTES_ERROR:
      return { ...state, detail: { ...state.detail, notesError: action.payload } };

    case ActionTypes.SET_NOTE_IDX:
      return { ...state, detail: { ...state.detail, noteIdx: action.payload } };

    case ActionTypes.SET_HAS_ANALYSIS:
      return { ...state, detail: { ...state.detail, hasAnalysis: action.payload } };

    case ActionTypes.TOGGLE_DETAIL:
      return { ...state, detail: { ...state.detail, show: action.payload ?? !state.detail.show } };

    case ActionTypes.SET_AI:
      return {
        ...state,
        ai: { ...state.ai, ...action.payload },
        detail: { ...state.detail, show: false },
      };

    case ActionTypes.TOGGLE_AI:
      return { ...state, ai: { ...state.ai, show: action.payload ?? !state.ai.show } };

    case ActionTypes.SET_DIAL_MODAL:
      return { ...state, dial: { ...state.dial, modal: action.payload } };

    case ActionTypes.SET_LOCKED_STUDENT:
      return { ...state, dial: { ...state.dial, lockedStudentId: action.payload } };

    case ActionTypes.SET_DIAL_CHECK:
      return {
        ...state,
        dial: {
          ...state.dial,
          checkByStudent: { ...state.dial.checkByStudent, [action.id]: action.data },
        },
      };

    case ActionTypes.SET_FOLLOWING:
      return { ...state, following: { ...state.following, data: action.payload } };

    case ActionTypes.SET_FOLLOWING_LOADING:
      return { ...state, following: { ...state.following, loading: action.payload } };

    case ActionTypes.SET_NOTE_TEXT:
      return { ...state, noteText: action.payload };

    case ActionTypes.SET_FOLLOW_UP_DATE:
      return { ...state, followUpDate: action.payload };

    case ActionTypes.SET_VISIT:
      return { ...state, visit: { ...state.visit, ...action.payload } };

    case ActionTypes.SET_CREATE:
      return { ...state, create: { ...state.create, ...action.payload } };

    case ActionTypes.TOGGLE_CREATE:
      return { ...state, create: { ...state.create, show: action.payload ?? !state.create.show } };

    case ActionTypes.SET_SETTINGS:
      return { ...state, settings: { ...state.settings, ...action.payload } };

    case ActionTypes.TOGGLE_SETTINGS:
      return { ...state, settings: { ...state.settings, show: action.payload ?? !state.settings.show } };

    case ActionTypes.SET_UI:
      return { ...state, ui: { ...state.ui, ...action.payload } };

    case ActionTypes.SET_VIEW_TAB:
      return { ...state, ui: { ...state.ui, viewTab: action.payload } };

    case ActionTypes.TOGGLE_MENU:
      return { ...state, ui: { ...state.ui, showMenu: action.payload ?? !state.ui.showMenu } };

    case ActionTypes.TOGGLE_HELP:
      return { ...state, ui: { ...state.ui, helpOpen: action.payload ?? !state.ui.helpOpen } };

    case ActionTypes.SET_ACTION_MSG:
      return { ...state, ui: { ...state.ui, actionMsg: action.payload } };

    case ActionTypes.SET_BACKLOG_ALERT:
      return { ...state, backlogAlert: action.payload };

    case ActionTypes.UPDATE_STUDENT:
      return {
        ...state,
        students: state.students.map((s) =>
          s.id === action.id ? { ...s, ...action.fields } : s
        ),
      };

    case ActionTypes.UPDATE_STUDENT_FIELD:
      return {
        ...state,
        students: state.students.map((s) =>
          s.id === action.id ? { ...s, [action.field]: action.value } : s
        ),
        detail: state.detail.student?.id === action.id
          ? { ...state.detail, student: { ...state.detail.student, [action.field]: action.value } }
          : state.detail,
      };

    case ActionTypes.REMOVE_STUDENT_FROM_QUEUE: {
      const removed = state.students.find((s) => s.id === action.id);
      const students = state.students.filter((s) => s.id !== action.id);
      return {
        ...state,
        students,
        currentIdx: Math.min(state.currentIdx, Math.max(students.length - 1, 0)),
        stats: decrementStatsForRemovedStudent(state.stats, removed),
        dial: state.dial.lockedStudentId === action.id
          ? { ...state.dial, lockedStudentId: null }
          : state.dial,
      };
    }

    default:
      return state;
  }
}

export default function useAgentWorkState() {
  const [state, dispatch] = useReducer(agentWorkReducer, initialState);

  // Action creators - 用 useMemo 包裹整个 actions 对象，避免每次渲染创建新引用
  const actions = useMemo(() => ({
    setStudents: (p) => dispatch({ type: ActionTypes.SET_STUDENTS, payload: p }),
    setStats: (p) => dispatch({ type: ActionTypes.SET_STATS, payload: p }),
    setSchoolGroups: (p) => dispatch({ type: ActionTypes.SET_SCHOOL_GROUPS, payload: p }),
    setCurrentIdx: (p) => dispatch({ type: ActionTypes.SET_CURRENT_IDX, payload: p }),

    setFilter: (key, value) => dispatch({ type: ActionTypes.SET_FILTER, key, value }),
    resetFilters: () => dispatch({ type: ActionTypes.RESET_FILTERS }),
    setSortConfig: (p) => dispatch({ type: ActionTypes.SET_SORT_CONFIG, payload: p }),
    setExpandedId: (p) => dispatch({ type: ActionTypes.SET_EXPANDED_ID, payload: p }),

    setDetail: (p) => dispatch({ type: ActionTypes.SET_DETAIL, payload: p }),
    setDetailLoading: (p) => dispatch({ type: ActionTypes.SET_DETAIL_LOADING, payload: p }),
    setDetailError: (p) => dispatch({ type: ActionTypes.SET_DETAIL_ERROR, payload: p }),
    setDetailNotes: (p) => dispatch({ type: ActionTypes.SET_DETAIL_NOTES, payload: p }),
    setDetailNotesError: (p) => dispatch({ type: ActionTypes.SET_DETAIL_NOTES_ERROR, payload: p }),
    setNoteIdx: (p) => dispatch({ type: ActionTypes.SET_NOTE_IDX, payload: p }),
    setHasAnalysis: (p) => dispatch({ type: ActionTypes.SET_HAS_ANALYSIS, payload: p }),
    toggleDetail: (p) => dispatch({ type: ActionTypes.TOGGLE_DETAIL, payload: p }),

    setAi: (p) => dispatch({ type: ActionTypes.SET_AI, payload: p }),
    toggleAi: (p) => dispatch({ type: ActionTypes.TOGGLE_AI, payload: p }),

    setDialModal: (p) => dispatch({ type: ActionTypes.SET_DIAL_MODAL, payload: p }),
    setLockedStudent: (p) => dispatch({ type: ActionTypes.SET_LOCKED_STUDENT, payload: p }),
    setDialCheck: (id, data) => dispatch({ type: ActionTypes.SET_DIAL_CHECK, id, data }),

    setFollowing: (p) => dispatch({ type: ActionTypes.SET_FOLLOWING, payload: p }),
    setFollowingLoading: (p) => dispatch({ type: ActionTypes.SET_FOLLOWING_LOADING, payload: p }),

    setNoteText: (p) => dispatch({ type: ActionTypes.SET_NOTE_TEXT, payload: p }),
    setFollowUpDate: (p) => dispatch({ type: ActionTypes.SET_FOLLOW_UP_DATE, payload: p }),
    setVisit: (p) => dispatch({ type: ActionTypes.SET_VISIT, payload: p }),

    setCreate: (p) => dispatch({ type: ActionTypes.SET_CREATE, payload: p }),
    toggleCreate: (p) => dispatch({ type: ActionTypes.TOGGLE_CREATE, payload: p }),

    setSettings: (p) => dispatch({ type: ActionTypes.SET_SETTINGS, payload: p }),
    toggleSettings: (p) => dispatch({ type: ActionTypes.TOGGLE_SETTINGS, payload: p }),

    setUi: (p) => dispatch({ type: ActionTypes.SET_UI, payload: p }),
    setViewTab: (p) => dispatch({ type: ActionTypes.SET_VIEW_TAB, payload: p }),
    toggleMenu: (p) => dispatch({ type: ActionTypes.TOGGLE_MENU, payload: p }),
    toggleHelp: (p) => dispatch({ type: ActionTypes.TOGGLE_HELP, payload: p }),
    setActionMsg: (p) => dispatch({ type: ActionTypes.SET_ACTION_MSG, payload: p }),

    setBacklogAlert: (p) => dispatch({ type: ActionTypes.SET_BACKLOG_ALERT, payload: p }),

    updateStudent: (id, fields) => dispatch({ type: ActionTypes.UPDATE_STUDENT, id, fields }),
    updateStudentField: (id, field, value) => dispatch({ type: ActionTypes.UPDATE_STUDENT_FIELD, id, field, value }),
    removeStudentFromQueue: (id) => dispatch({ type: ActionTypes.REMOVE_STUDENT_FROM_QUEUE, id }),
  }), []); // dispatch 是稳定的，所以依赖数组为空

  return { state, actions };
}
