import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api';
import { unwrapApiResponse } from '../utils';

const AssistantContext = createContext(null);
const WIDTH_KEY = 'crm_assistant_width';

function storedWidth() {
  const stored = localStorage.getItem(WIDTH_KEY);
  if (stored === null || stored === '') return 420;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.min(600, Math.max(360, value)) : 420;
}

function routeContext(location) {
  const context = { route: `${location.pathname}${location.search}` };
  const match = location.pathname.match(/^\/admin\/leads\/(\d+)$/);
  if (match) context.student_id = Number(match[1]);
  return context;
}

export function AssistantProvider({ active, children }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [width, setWidthState] = useState(storedWidth);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [oneTimeResults, setOneTimeResults] = useState({});

  const setWidth = useCallback((value) => {
    const normalized = Math.min(600, Math.max(360, Number(value) || 420));
    setWidthState(normalized);
    localStorage.setItem(WIDTH_KEY, String(normalized));
  }, []);

  const loadDetail = useCallback(async (sessionId) => {
    if (!sessionId) return null;
    const response = await api.get(`/admin/assistant/sessions/${sessionId}`);
    const data = unwrapApiResponse(response);
    setDetail(data);
    setActiveSessionId(sessionId);
    return data;
  }, []);

  const refreshSessions = useCallback(async () => {
    const response = await api.get('/admin/assistant/sessions');
    const rows = unwrapApiResponse(response) || [];
    setSessions(rows);
    return rows;
  }, []);

  const createSession = useCallback(async () => {
    setError('');
    const response = await api.post('/admin/assistant/sessions');
    const session = unwrapApiResponse(response);
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    setActiveSessionId(session.id);
    setDetail({ session, messages: [], tool_calls: [] });
    return session;
  }, []);

  const ensureSession = useCallback(async () => {
    if (activeSessionId) {
      if (!detail) await loadDetail(activeSessionId);
      return activeSessionId;
    }
    const rows = await refreshSessions();
    if (rows.length) {
      await loadDetail(rows[0].id);
      return rows[0].id;
    }
    const session = await createSession();
    return session.id;
  }, [activeSessionId, createSession, detail, loadDetail, refreshSessions]);

  const openAssistant = useCallback(async () => {
    if (!active) return;
    setOpen(true);
    setError('');
    setLoading(true);
    try {
      await ensureSession();
    } catch (err) {
      setError(err.response?.data?.msg || err.message || '助手加载失败');
    } finally {
      setLoading(false);
    }
  }, [active, ensureSession]);

  const selectSession = useCallback(async (sessionId) => {
    setError('');
    setLoading(true);
    try {
      await loadDetail(sessionId);
    } catch (err) {
      setError(err.response?.data?.msg || err.message || '会话加载失败');
    } finally {
      setLoading(false);
    }
  }, [loadDetail]);

  const sendMessage = useCallback(async (content) => {
    const text = content.trim();
    if (!text || sending) return null;
    setError('');
    setSending(true);
    try {
      const sessionId = activeSessionId || await ensureSession();
      const response = await api.post(`/admin/assistant/sessions/${sessionId}/messages`, {
        content: text,
        context: routeContext(location),
      });
      const data = unwrapApiResponse(response);
      setDetail(data);
      await refreshSessions();
      return data;
    } catch (err) {
      setError(err.response?.data?.msg || err.message || '消息发送失败');
      throw err;
    } finally {
      setSending(false);
    }
  }, [activeSessionId, ensureSession, location, refreshSessions, sending]);

  const approveToolCall = useCallback(async (toolCall, phrase = '') => {
    setError('');
    setSending(true);
    try {
      const response = await api.post(`/admin/assistant/tool-calls/${toolCall.id}/approve`, {
        approval_token: toolCall.approval_token,
        confirmation_phrase: phrase,
      });
      const result = unwrapApiResponse(response);
      if (result?.result?.new_password) {
        setOneTimeResults((current) => ({
          ...current,
          [toolCall.id]: { new_password: result.result.new_password },
        }));
      }
      await loadDetail(activeSessionId);
      await refreshSessions();
      return result;
    } catch (err) {
      setError(err.response?.data?.msg || err.message || '操作执行失败');
      throw err;
    } finally {
      setSending(false);
    }
  }, [activeSessionId, loadDetail, refreshSessions]);

  const rejectToolCall = useCallback(async (toolCall) => {
    setError('');
    setSending(true);
    try {
      const response = await api.post(`/admin/assistant/tool-calls/${toolCall.id}/reject`);
      unwrapApiResponse(response);
      await loadDetail(activeSessionId);
      await refreshSessions();
    } catch (err) {
      setError(err.response?.data?.msg || err.message || '取消操作失败');
      throw err;
    } finally {
      setSending(false);
    }
  }, [activeSessionId, loadDetail, refreshSessions]);

  const value = useMemo(() => ({
    active,
    open,
    setOpen,
    openAssistant,
    maximized,
    setMaximized,
    width,
    setWidth,
    sessions,
    activeSessionId,
    detail,
    loading,
    sending,
    error,
    setError,
    oneTimeResults,
    initializeAssistant: ensureSession,
    createSession,
    selectSession,
    sendMessage,
    approveToolCall,
    rejectToolCall,
    refreshSessions,
  }), [
    active,
    activeSessionId,
    approveToolCall,
    createSession,
    detail,
    error,
    ensureSession,
    loading,
    maximized,
    oneTimeResults,
    open,
    openAssistant,
    refreshSessions,
    rejectToolCall,
    selectSession,
    sendMessage,
    sending,
    sessions,
    setWidth,
    width,
  ]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useAssistant must be used within AssistantProvider');
  return value;
}
