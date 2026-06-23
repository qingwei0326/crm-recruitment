import { useCallback } from 'react';
import api from '../api';
import { getApiErrorMessage } from '../utils';

/**
 * 管理学生详情面板相关逻辑
 */
export default function useAgentDetail({ state, actions, students, toast }) {
  // 加载详情
  const loadDetail = useCallback(async (id) => {
    const fallbackStudent = students.find((s) => s.id === id);
    if (fallbackStudent) {
      actions.setDetail({
        student: fallbackStudent,
        show: true,
        loading: true,
        error: '',
        notesError: '',
      });
    } else {
      actions.setDetail({ show: true, loading: true, error: '', notesError: '' });
    }

    try {
      const [studentResult, notesResult, callsResult] = await Promise.allSettled([
        api.get(`/students/${id}`),
        api.get(`/notes?student_id=${id}`),
        api.get(`/calls?student_id=${id}&page_size=5`),
      ]);

      const detailUpdate = { loading: false };

      if (studentResult.status === 'fulfilled') {
        detailUpdate.student = studentResult.value.data.data;
      } else {
        detailUpdate.error = getApiErrorMessage(studentResult.reason);
      }

      if (notesResult.status === 'fulfilled') {
        detailUpdate.notes = notesResult.value.data.data || [];
        detailUpdate.notesError = '';
      } else {
        detailUpdate.notes = [];
        detailUpdate.notesError = getApiErrorMessage(notesResult.reason);
      }

      detailUpdate.noteIdx = 0;

      if (callsResult.status === 'fulfilled') {
        detailUpdate.hasAnalysis = callsResult.value.data.data?.list?.some((c) => c.analyzed_at);
      } else {
        detailUpdate.hasAnalysis = false;
      }

      actions.setDetail(detailUpdate);
    } catch {
      actions.setDetail({ loading: false, error: '加载失败' });
    }
  }, [students, actions]);

  // 更新详情字段
  const updateDetailField = useCallback(async (field, value) => {
    const student = state.detail.student;
    if (!student) return;
    try {
      await api.put(`/students/${student.id}`, { [field]: value });
      actions.updateStudentField(student.id, field, value);
    } catch (e) {
      toast?.error('更新失败: ' + getApiErrorMessage(e));
    }
  }, [state.detail.student, actions, toast]);

  // 添加备注
  const addNote = useCallback(async (targetId, noteText) => {
    const id = targetId || state.detail.student?.id;
    if (!noteText.trim() || !id) return;
    try {
      await api.post('/notes', { student_id: id, content: noteText });
      actions.setNoteText('');
      actions.setActionMsg('已记录');
      setTimeout(() => actions.setActionMsg(''), 2000);
      loadDetail(id);
    } catch (e) {
      toast?.error('添加备注失败: ' + getApiErrorMessage(e));
    }
  }, [state.detail.student, actions, loadDetail, toast]);

  // 添加回访
  const addFollowUp = useCallback(async (current, followUpDate) => {
    if (!followUpDate || !current) return;
    try {
      await api.post('/follow-ups', {
        student_id: current.id,
        follow_up_date: followUpDate + ':00',
      });
      actions.setFollowUpDate('');
      actions.setActionMsg('回访提醒已设置');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error('添加回访失败: ' + getApiErrorMessage(e));
    }
  }, [actions, toast]);

  // 添加到访
  const addVisit = useCallback(async (current, visit) => {
    if (!visit.date || !current) return;
    try {
      await api.post('/visits', {
        student_id: current.id,
        visit_type: visit.type,
        scheduled_date: visit.date + ':00',
        notes: visit.notes,
      });
      actions.setVisit({ date: '', notes: '' });
      actions.setActionMsg('到访已记录');
      setTimeout(() => actions.setActionMsg(''), 2000);
    } catch (e) {
      toast?.error('添加到访失败: ' + getApiErrorMessage(e));
    }
  }, [actions, toast]);

  // 打开 AI 面板
  const openAiPanel = useCallback((student) => {
    actions.setAi({ activeStudent: student, show: true });
  }, [actions]);

  return {
    loadDetail,
    updateDetailField,
    addNote,
    addFollowUp,
    addVisit,
    openAiPanel,
  };
}
