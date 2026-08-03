import { useCallback, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import { getApiErrorMessage } from '../utils';
import { useConfirm } from '../components/ConfirmDialog';
import {
  detailForOperatorResult,
  displayStatusForOperatorResult,
  payloadForOperatorResult,
} from '../operatorResultPolicy';
import { STAGES } from '../labels';

function compactPatch(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

/**
 * 管理学生列表数据、筛选和列表内快捷修改。
 */
export default function useAgentStudents({ state, actions, toast }) {
  const confirm = useConfirm();
  const { students, filters, sortConfig, currentIdx } = state;
  const {
    searchQuery,
    selectedSchool,
    selectedStage,
    selectedIntent,
    selectedStatus,
    scoreRange,
  } = filters;

  const confirmedStudentsRef = useRef(new Map());
  const projectedStudentsRef = useRef(new Map());
  const mutationChainsRef = useRef(new Map());
  const activeFieldTokensRef = useRef(new Map());
  const pendingCountsRef = useRef(new Map());
  const operationSequenceRef = useRef(0);
  const actionTimerRef = useRef(null);
  const currentStudentIdRef = useRef(null);

  const flashAction = useCallback((message) => {
    if (!message) return;
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actions.setActionMsg(message);
    actionTimerRef.current = setTimeout(() => {
      actions.setActionMsg('');
      actionTimerRef.current = null;
    }, 1500);
  }, [actions]);

  useEffect(() => () => {
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
  }, []);

  // Keep server-confirmed snapshots separate from optimistic projections.
  useEffect(() => {
    const visibleIds = new Set(students.map((student) => student.id));
    students.forEach((student) => {
      const activeFields = activeFieldTokensRef.current.get(student.id);
      if (!activeFields || activeFields.size === 0) {
        confirmedStudentsRef.current.set(student.id, { ...student });
        projectedStudentsRef.current.set(student.id, { ...student });
        return;
      }

      const confirmed = { ...(confirmedStudentsRef.current.get(student.id) || student) };
      const projected = { ...(projectedStudentsRef.current.get(student.id) || student) };
      Object.entries(student).forEach(([key, value]) => {
        if (!activeFields.has(key)) {
          confirmed[key] = value;
          projected[key] = value;
        }
      });
      confirmedStudentsRef.current.set(student.id, confirmed);
      projectedStudentsRef.current.set(student.id, projected);
    });

    for (const id of confirmedStudentsRef.current.keys()) {
      if (!visibleIds.has(id) && !pendingCountsRef.current.get(id)) {
        confirmedStudentsRef.current.delete(id);
        projectedStudentsRef.current.delete(id);
        activeFieldTokensRef.current.delete(id);
      }
    }
  }, [students]);

  const fetchToday = useCallback(async () => {
    try {
      const res = await api.get('/tasks/today');
      if (res.data.code === 0) {
        const list = res.data.data.list || [];
        const previousCurrentId = currentStudentIdRef.current;
        confirmedStudentsRef.current = new Map(list.map((student) => [student.id, { ...student }]));
        projectedStudentsRef.current = new Map(list.map((student) => [student.id, { ...student }]));
        actions.setStudents(list);
        actions.setStats(res.data.data.stats || {});
        actions.setSchoolGroups(res.data.data.schools || []);
        actions.setCurrentIdx((index) => {
          const preservedIndex = list.findIndex(
            (student) => Number(student.id) === Number(previousCurrentId),
          );
          if (preservedIndex >= 0) return preservedIndex;
          return Math.min(index, Math.max(list.length - 1, 0));
        });
      }
    } catch {
      toast?.error('加载待拨打任务失败');
    }
  }, [actions, toast]);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  useEffect(() => {
    actions.setCurrentIdx(0);
  }, [searchQuery, selectedStatus, selectedSchool, selectedStage, selectedIntent, scoreRange, actions]);

  const filteredStudents = useMemo(() => {
    let result = students;

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((student) =>
        (student.name || '').toLowerCase().includes(query)
        || (student.guardian_phone || '').includes(query)
        || (student.guardian2_phone || '').includes(query)
        || (student.school_name || '').toLowerCase().includes(query)
      );
    }
    if (selectedStatus) result = result.filter((student) => student.status === selectedStatus);
    if (selectedSchool) result = result.filter((student) => (student.school_name || '未知学校') === selectedSchool);
    if (selectedStage) result = result.filter((student) => student.stage === selectedStage);
    if (selectedIntent) result = result.filter((student) => student.intent_level === selectedIntent);
    if (scoreRange.min !== '' || scoreRange.max !== '') {
      result = result.filter((student) => {
        if (student.score == null || student.score === '') return false;
        const score = Number(student.score);
        if (scoreRange.min !== '' && score < Number(scoreRange.min)) return false;
        if (scoreRange.max !== '' && score > Number(scoreRange.max)) return false;
        return true;
      });
    }
    return result;
  }, [students, searchQuery, selectedStatus, selectedSchool, selectedStage, selectedIntent, scoreRange]);

  const filteredStats = useMemo(() => {
    const hasScoreFilter = scoreRange.min !== '' || scoreRange.max !== '';
    const hasFilters = Boolean(
      searchQuery.trim()
      || selectedStatus
      || selectedSchool
      || selectedStage
      || selectedIntent
      || hasScoreFilter,
    );
    if (!hasFilters) return state.stats;

    const total = filteredStudents.length;
    const pending = filteredStudents.filter((student) => student.status === '未联系').length;
    const followUp = filteredStudents.filter((student) => student.status === '待回访').length;
    const handledStatuses = ['已联系', '未接', '待回访', '已报名', '无效'];
    const handled = filteredStudents.filter((student) => handledStatuses.includes(student.status)).length;
    return {
      total,
      done: handled,
      pending,
      follow_up: followUp,
      progress_pct: total > 0 ? Math.round((handled / total) * 1000) / 10 : 0,
    };
  }, [searchQuery, selectedStatus, selectedSchool, selectedStage, selectedIntent, scoreRange, state.stats, filteredStudents]);

  const sortedStudents = useMemo(() => {
    return [...filteredStudents].sort((left, right) => {
      const { key, direction } = sortConfig;
      if (!key) return 0;
      const getValue = (student) => {
        switch (key) {
          case 'name': return student.name || '';
          case 'school_name': return student.school_name || '';
          case 'stage': return STAGES.indexOf(student.stage);
          case 'intent_level': return student.intent_level === '无' ? -1 : (student.intent_level === 'A' ? 0 : student.intent_level === 'B' ? 1 : 2);
          case 'status': return student.status || '';
          case 'days': return student.days_since_assigned ?? 999;
          default: return '';
        }
      };
      const leftValue = getValue(left);
      const rightValue = getValue(right);
      if (leftValue < rightValue) return direction === 'asc' ? -1 : 1;
      if (leftValue > rightValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredStudents, sortConfig]);

  const safeCurrentIdx = Math.min(currentIdx, Math.max(filteredStudents.length - 1, 0));
  const current = filteredStudents[safeCurrentIdx];

  useEffect(() => {
    currentStudentIdRef.current = current?.id ?? null;
    if (safeCurrentIdx !== currentIdx) actions.setCurrentIdx(safeCurrentIdx);
  }, [actions, current?.id, currentIdx, safeCurrentIdx]);

  /**
   * Apply immediately in the UI, but serialize writes for the same student.
   * Per-field ownership prevents an older failure from reverting a newer edit.
   */
  const executeOptimisticUpdate = useCallback(async ({
    id,
    optimisticFields,
    request,
    successMessage,
    errorPrefix,
    removeFromQueueOnSuccess = false,
  }) => {
    const optimisticPatch = compactPatch(optimisticFields);
    const projectedBefore = projectedStudentsRef.current.get(id)
      || students.find((student) => student.id === id);
    if (!projectedBefore || Object.keys(optimisticPatch).length === 0) return false;

    if (!confirmedStudentsRef.current.has(id)) {
      confirmedStudentsRef.current.set(id, { ...projectedBefore });
    }

    const token = ++operationSequenceRef.current;
    const fieldTokens = activeFieldTokensRef.current.get(id) || new Map();
    Object.keys(optimisticPatch).forEach((key) => fieldTokens.set(key, token));
    activeFieldTokensRef.current.set(id, fieldTokens);
    pendingCountsRef.current.set(id, (pendingCountsRef.current.get(id) || 0) + 1);

    const projected = { ...projectedBefore, ...optimisticPatch };
    projectedStudentsRef.current.set(id, projected);
    actions.updateStudent(id, optimisticPatch);
    flashAction(successMessage);

    const previous = mutationChainsRef.current.get(id) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const response = await request();
      if (response.data?.code !== undefined && response.data.code !== 0) {
        throw new Error(response.data.msg || '服务器拒绝了本次修改');
      }
      return response;
    });
    mutationChainsRef.current.set(id, operation);

    try {
      const response = await operation;
      const serverPatch = compactPatch(response.data?.data || {});
      const confirmedBefore = confirmedStudentsRef.current.get(id) || projectedBefore;
      confirmedStudentsRef.current.set(id, {
        ...confirmedBefore,
        ...optimisticPatch,
        ...serverPatch,
      });

      const latestFieldTokens = activeFieldTokensRef.current.get(id) || new Map();
      const uiPatch = {};
      Object.entries({ ...optimisticPatch, ...serverPatch }).forEach(([key, value]) => {
        const owner = latestFieldTokens.get(key);
        if (owner === undefined || owner === token) uiPatch[key] = value;
      });
      if (Object.keys(uiPatch).length > 0) {
        const latestProjected = projectedStudentsRef.current.get(id) || projectedBefore;
        projectedStudentsRef.current.set(id, { ...latestProjected, ...uiPatch });
        actions.updateStudent(id, uiPatch);
      }
      if (removeFromQueueOnSuccess) {
        confirmedStudentsRef.current.delete(id);
        projectedStudentsRef.current.delete(id);
        activeFieldTokensRef.current.delete(id);
        actions.removeStudentFromQueue?.(id);
      }
      return true;
    } catch (error) {
      const latestFieldTokens = activeFieldTokensRef.current.get(id) || new Map();
      const confirmed = confirmedStudentsRef.current.get(id) || projectedBefore;
      const rollbackPatch = {};
      Object.keys(optimisticPatch).forEach((key) => {
        if (latestFieldTokens.get(key) === token) rollbackPatch[key] = confirmed[key];
      });
      if (Object.keys(rollbackPatch).length > 0) {
        const latestProjected = projectedStudentsRef.current.get(id) || projectedBefore;
        projectedStudentsRef.current.set(id, { ...latestProjected, ...rollbackPatch });
        actions.updateStudent(id, rollbackPatch);
      }
      toast?.error(`${errorPrefix}: ${getApiErrorMessage(error)}，已撤回界面修改`);
      return false;
    } finally {
      const latestFieldTokens = activeFieldTokensRef.current.get(id);
      Object.keys(optimisticPatch).forEach((key) => {
        if (latestFieldTokens?.get(key) === token) latestFieldTokens.delete(key);
      });
      if (latestFieldTokens?.size === 0) activeFieldTokensRef.current.delete(id);

      const pendingCount = Math.max((pendingCountsRef.current.get(id) || 1) - 1, 0);
      if (pendingCount === 0) pendingCountsRef.current.delete(id);
      else pendingCountsRef.current.set(id, pendingCount);
      if (mutationChainsRef.current.get(id) === operation) mutationChainsRef.current.delete(id);
    }
  }, [actions, flashAction, students, toast]);

  const updateStatus = useCallback(async (id, result) => {
    const status = typeof result === 'string' ? result : result.label || result.status;
    if ((typeof result === 'object' && result.code === 'enrolled') || status === '已报名') {
      const accepted = await confirm({
        title: '确认报名',
        message: '确认将此学生标记为已报名？阶段也会同步更新为已报名。',
        confirmText: '确认报名',
      });
      if (!accepted) return false;
    }

    const optimisticFields = {
      status: displayStatusForOperatorResult(result),
      status_detail: detailForOperatorResult(result),
      ...(status === '已报名' ? { stage: '已报名' } : {}),
    };
    return executeOptimisticUpdate({
      id,
      optimisticFields,
      request: () => api.put(`/students/${id}`, payloadForOperatorResult(result)),
      successMessage: '话务结果已记录',
      errorPrefix: '更新状态失败',
      removeFromQueueOnSuccess: !['未联系', '新线索'].includes(optimisticFields.status),
    });
  }, [confirm, executeOptimisticUpdate]);

  const updateIntentById = useCallback((id, level) => {
    return executeOptimisticUpdate({
      id,
      optimisticFields: { intent_level: level },
      request: () => api.put(`/students/${id}`, { intent_level: level }),
      successMessage: `意向已调整为 ${level} 级`,
      errorPrefix: '更新意向失败',
    });
  }, [executeOptimisticUpdate]);

  const updateStage = useCallback((id, stage) => {
    return executeOptimisticUpdate({
      id,
      optimisticFields: {
        stage,
        ...(stage === '已报名' ? { status: '已报名', status_detail: '' } : {}),
      },
      request: () => api.put(`/students/${id}/stage`, { stage }),
      successMessage: '跟进阶段已更新',
      errorPrefix: '更新阶段失败',
      removeFromQueueOnSuccess: stage === '已报名',
    });
  }, [executeOptimisticUpdate]);

  const updateScore = useCallback((id, score) => {
    return executeOptimisticUpdate({
      id,
      optimisticFields: { score },
      request: () => api.put(`/students/${id}`, { score }),
      successMessage: '成绩已更新',
      errorPrefix: '更新成绩失败',
    });
  }, [executeOptimisticUpdate]);

  const toggleNeedHelp = useCallback(() => {
    if (!current) return Promise.resolve(false);
    const needHelp = !current.need_help;
    return executeOptimisticUpdate({
      id: current.id,
      optimisticFields: { need_help: needHelp },
      request: () => api.post(`/students/${current.id}/need-help`),
      successMessage: needHelp ? '已标记需要协助' : '已取消协助标记',
      errorPrefix: '更新协助状态失败',
    });
  }, [current, executeOptimisticUpdate]);

  const handleCreate = useCallback(async (newStudent) => {
    if (!newStudent.name) {
      actions.setCreate({ error: '姓名和电话必填' });
      return;
    }
    try {
      const res = await api.post('/students', newStudent);
      if (res.data.code === 0) {
        actions.toggleCreate(false);
        actions.setCreate({ error: '' });
        await fetchToday();
        flashAction('学生已添加');
      } else {
        actions.setCreate({ error: res.data.msg || '创建失败' });
      }
    } catch (error) {
      actions.setCreate({ error: getApiErrorMessage(error) });
    }
  }, [actions, fetchToday, flashAction]);

  return {
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
  };
}
