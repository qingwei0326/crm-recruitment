import { useCallback, useEffect, useMemo } from 'react';
import api from '../api';
import { getApiErrorMessage } from '../utils';

/**
 * 管理学生列表数据和筛选逻辑
 */
export default function useAgentStudents({ state, actions, toast }) {
  const { students, filters, sortConfig, currentIdx } = state;
  const {
    searchQuery, selectedSchool, selectedStage,
    selectedIntent, selectedStatus, scoreRange,
  } = filters;

  // 加载今日任务
  const fetchToday = useCallback(async () => {
    try {
      const res = await api.get('/tasks/today');
      if (res.data.code === 0) {
        actions.setStudents(res.data.data.list || []);
        actions.setStats(res.data.data.stats || {});
        actions.setSchoolGroups(res.data.data.schools || []);
        actions.setCurrentIdx((idx) =>
          Math.min(idx, Math.max((res.data.data.list || []).length - 1, 0))
        );
      }
    } catch {
      toast?.error('加载今日任务失败');
    }
  }, [actions, toast]);

  // 初始加载
  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  // 筛选变化时重置索引
  useEffect(() => {
    actions.setCurrentIdx(0);
  }, [searchQuery, selectedStatus, selectedSchool, selectedStage, selectedIntent, scoreRange, actions]);

  // 筛选后的学生列表
  const filteredStudents = useMemo(() => {
    let result = students;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((s) =>
        (s.name || '').toLowerCase().includes(q)
        || (s.guardian_phone || '').includes(q)
        || (s.guardian2_phone || '').includes(q)
        || (s.school_name || '').toLowerCase().includes(q)
      );
    }
    if (selectedStatus) result = result.filter((s) => s.status === selectedStatus);
    if (selectedSchool) result = result.filter((s) => (s.school_name || '未知学校') === selectedSchool);
    if (selectedStage) result = result.filter((s) => s.stage === selectedStage);
    if (selectedIntent) result = result.filter((s) => s.intent_level === selectedIntent);
    if (scoreRange.min !== '' || scoreRange.max !== '') {
      result = result.filter((s) => {
        const sc = s.score;
        if (sc == null || sc === '') return false;
        const n = Number(sc);
        if (scoreRange.min !== '' && n < Number(scoreRange.min)) return false;
        if (scoreRange.max !== '' && n > Number(scoreRange.max)) return false;
        return true;
      });
    }
    return result;
  }, [students, searchQuery, selectedStatus, selectedSchool, selectedStage, selectedIntent, scoreRange]);

  // 筛选后的统计
  const filteredStats = useMemo(() => {
    const hasScoreFilter = scoreRange.min !== '' || scoreRange.max !== '';
    if (!selectedSchool && !selectedStage && !selectedIntent && !hasScoreFilter) {
      return state.stats;
    }
    const list = filteredStudents;
    const total = list.length;
    const pending = list.filter((s) => s.status === '新线索').length;
    const handledStatuses = ['非常有意向', '意向了解加微', '未接', '高分段', '无意向', '孩子不想读', '已报名'];
    const handled = list.filter((s) => handledStatuses.includes(s.status)).length;
    return {
      total,
      done: handled,
      pending,
      follow_up: 0,
      progress_pct: total > 0 ? Math.round((handled / total) * 1000) / 10 : 0,
    };
  }, [selectedSchool, selectedStage, selectedIntent, scoreRange, state.stats, filteredStudents]);

  // 排序后的学生列表
  const sortedStudents = useMemo(() => {
    return [...filteredStudents].sort((a, b) => {
      const { key, direction } = sortConfig;
      if (!key) return 0;
      const getVal = (s) => {
        switch (key) {
          case 'name': return s.name || '';
          case 'school_name': return s.school_name || '';
          case 'stage': return ['初次联系', '有意向', '已送资料', '预约参观', '已来访', '已报名'].indexOf(s.stage);
          case 'intent_level': return s.intent_level === '无' ? -1 : (s.intent_level === 'A' ? 0 : s.intent_level === 'B' ? 1 : 2);
          case 'status': return s.status || '';
          case 'days': return s.days_since_assigned ?? 999;
          default: return '';
        }
      };
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredStudents, sortConfig]);

  // 当前学生
  const current = filteredStudents[currentIdx];

  // 更新学生状态
  const updateStatus = useCallback(async (id, s) => {
    const status = typeof s === 'string' ? s : s.status;
    let payload = { status };
    if (typeof s === 'object' && s.invalid_reason) {
      payload.invalid_reason = s.invalid_reason;
    }
    try {
      await api.put(`/students/${id}`, payload);
      actions.updateStudent(id, { status });
      if (state.dial.lockedStudentId === id) {
        actions.setLockedStudent(null);
      }
      actions.setActionMsg('状态已更新');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error('更新状态失败: ' + getApiErrorMessage(e));
    }
  }, [actions, state.dial.lockedStudentId, toast]);

  // 更新意向
  const updateIntentById = useCallback(async (id, level) => {
    try {
      await api.put(`/students/${id}`, { intent_level: level });
      actions.updateStudent(id, { intent_level: level });
    } catch (e) {
      toast?.error('更新意向失败: ' + getApiErrorMessage(e));
    }
  }, [actions, toast]);

  // 更新阶段
  const updateStage = useCallback(async (id, stag) => {
    try {
      await api.put(`/students/${id}/stage`, { stage: stag });
      actions.updateStudent(id, {
        stage: stag,
        status: stag === '已报名' ? '已报名' : undefined,
      });
      actions.setActionMsg('阶段已更新');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error('更新阶段失败: ' + getApiErrorMessage(e));
    }
  }, [actions, toast]);

  // 更新成绩
  const updateScore = useCallback(async (id, score) => {
    try {
      await api.put(`/students/${id}`, { score });
      actions.updateStudent(id, { score });
      actions.setActionMsg('成绩已更新');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error('更新成绩失败: ' + getApiErrorMessage(e));
    }
  }, [actions, toast]);

  // 切换协助标记
  const toggleNeedHelp = useCallback(async () => {
    if (!current) return;
    try {
      const res = await api.post(`/students/${current.id}/need-help`);
      actions.updateStudent(current.id, { need_help: res.data.data.need_help });
      actions.setActionMsg(res.data.data.need_help ? '已标记需要协助' : '已取消协助标记');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error('操作失败: ' + getApiErrorMessage(e));
    }
  }, [current, actions, toast]);

  // 创建学生
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
        fetchToday();
        actions.setActionMsg('学生已添加');
        setTimeout(() => actions.setActionMsg(''), 2000);
      } else {
        actions.setCreate({ error: res.data.msg || '创建失败' });
      }
    } catch (e) {
      actions.setCreate({ error: getApiErrorMessage(e) });
    }
  }, [actions, fetchToday]);

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
