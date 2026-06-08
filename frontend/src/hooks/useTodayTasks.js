import { useState, useEffect, useCallback } from 'react';
import api from '../api';

const PAGE_SIZE = 30;

/**
 * 封装 GET /api/tasks/today。
 * 搜索在服务端执行（SQL LIKE），支持按姓名/电话筛选。
 * 返回 { students, stats, schools, truncated, loading, error, refetch, search, setSearch, loadMore, hasMore, total }
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
  const [search, setSearch] = useState('');

  const fetchTasks = useCallback(async (searchQuery = '') => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: PAGE_SIZE, offset: 0 };
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await api.get('/tasks/today', { params });
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

  // Debounced search: when search changes, refetch from server
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTasks(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchTasks]);

  const loadMore = useCallback(async () => {
    try {
      const params = { limit: PAGE_SIZE, offset: students.length };
      if (search.trim()) params.search = search.trim();
      const res = await api.get('/tasks/today', { params });
      if (res.data.code === 0) {
        setStudents(prev => [...prev, ...(res.data.data.list || [])]);
        setTotal(res.data.data.total || 0);
      }
    } catch (e) {
      // silently fail — existing list is still valid
    }
  }, [students.length, search]);

  const hasMore = students.length < total;
  return { students, rawStudents: students, stats, schools, truncated, loading, error, refetch: fetchTasks, search, setSearch, loadMore, hasMore, total };
}
