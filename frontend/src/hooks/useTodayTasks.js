import { useState, useEffect, useCallback } from 'react';
import api from '../api';

/**
 * 封装 GET /api/tasks/today。
 * 返回 { students, stats, loading, error, refetch }
 */
export default function useTodayTasks() {
  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    done: 0,
    pending: 0,
    follow_up: 0,
    progress_pct: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/tasks/today');
      if (res.data.code === 0) {
        setStudents(res.data.data.list || []);
        setStats(res.data.data.stats || {});
      } else {
        setError(res.data.msg || '加载失败');
      }
    } catch (e) {
      setError(
        e?.response?.data?.detail || e?.response?.data?.msg || e?.message || '加载失败',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { students, stats, loading, error, refetch: fetchTasks };
}
