import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';

/**
 * 封装 GET /api/tasks/today。
 * 返回 { students, stats, schools, truncated, loading, error, refetch }
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
  const [schools, setSchools] = useState([]);
  const [truncated, setTruncated] = useState(false);
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

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.trim().toLowerCase();
    return students.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.guardian_phone?.includes(q) ||
      s.guardian2_phone?.includes(q)
    );
  }, [students, search]);

  return { students: filteredStudents, rawStudents: students, stats, schools, truncated, loading, error, refetch: fetchTasks, search, setSearch };
}
