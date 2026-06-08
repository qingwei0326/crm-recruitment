import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';

const PAGE_SIZE = 30;

/**
 * 封装 GET /api/tasks/today。
 * 返回 { students, stats, schools, truncated, loading, error, refetch }
 */
export default function useTodayTasks() {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({
    total: 0,
    done: 0,
    pending: 0,
    follow_up: 0,
    progress_pct: 0,
  });
  const [schools, setSchools] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/tasks/today', { params: { limit: PAGE_SIZE, offset: 0 } });
      if (res.data.code === 0) {
        setStudents(res.data.data.list || []);
        setTotal(res.data.data.total || 0);
        setStats(res.data.data.stats || {});
        setSchools(res.data.data.schools || []);
        setTruncated(!!res.data.data.truncated);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetching pattern
    fetchTasks();
  }, [fetchTasks]);

  const [search, setSearch] = useState('');

  const loadMore = useCallback(async () => {
    try {
      const res = await api.get('/tasks/today', { params: { limit: PAGE_SIZE, offset: students.length } });
      if (res.data.code === 0) {
        setStudents(prev => [...prev, ...(res.data.data.list || [])]);
        setTotal(res.data.data.total || 0);
      }
    } catch (e) {
      // silently fail — existing list is still valid
    }
  }, [students.length]);

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.trim().toLowerCase();
    return students.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.guardian_phone?.includes(q) ||
      s.guardian2_phone?.includes(q)
    );
  }, [students, search]);

  const hasMore = students.length < total;
  return { students: filteredStudents, rawStudents: students, stats, schools, truncated, loading, error, refetch: fetchTasks, search, setSearch, loadMore, hasMore, total };
}
