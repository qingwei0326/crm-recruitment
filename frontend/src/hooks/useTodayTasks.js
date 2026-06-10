import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [selectedSchool, setSelectedSchool] = useState(null);

  const fetchTasks = useCallback(async (searchQuery = '', schoolFilter = null) => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: PAGE_SIZE, offset: 0 };
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (schoolFilter) params.school_name = schoolFilter;
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

  // 单一数据源：首屏立即拉取，之后随搜索/学校变化防抖拉取。
  // （此前还另有一个挂载 effect，会让首屏并发两次相同请求、产生竞态，已合并。）
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      fetchTasks(search, selectedSchool); // 首屏立即加载，无 300ms 延迟
      return undefined;
    }
    const timer = setTimeout(() => {
      fetchTasks(search, selectedSchool);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, selectedSchool, fetchTasks]);

  const loadMore = useCallback(async () => {
    try {
      const params = { limit: PAGE_SIZE, offset: students.length };
      if (search.trim()) params.search = search.trim();
      if (selectedSchool) params.school_name = selectedSchool;
      const res = await api.get('/tasks/today', { params });
      if (res.data.code === 0) {
        setStudents(prev => [...prev, ...(res.data.data.list || [])]);
        setTotal(res.data.data.total || 0);
      }
    } catch {
      // silently fail — existing list is still valid
    }
  }, [students.length, search, selectedSchool]);

  const hasMore = students.length < total;
  const refetch = useCallback((searchQuery, schoolFilter) => {
    const nextSearch = searchQuery === undefined ? search : searchQuery;
    const nextSchool = schoolFilter === undefined ? selectedSchool : schoolFilter;
    return fetchTasks(nextSearch, nextSchool);
  }, [fetchTasks, search, selectedSchool]);

  return { students, rawStudents: students, stats, schools, truncated, loading, error, refetch, search, setSearch, selectedSchool, setSelectedSchool, loadMore, hasMore, total };
}
