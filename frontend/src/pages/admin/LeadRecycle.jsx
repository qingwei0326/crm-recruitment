/**
 * 线索回收 — 按学校或区域分组，一键回收超时学员至未分配池
 */

import { useEffect, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { getApiErrorMessage } from '../../utils';
import {
  Loader2, Menu, Sun, Moon, RefreshCcw, RotateCcw,
  ChevronDown, ChevronUp,
  School, MapPin,
} from 'lucide-react';

export default function LeadRecycle() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [days, setDays] = useState(3);
  const [groupBy, setGroupBy] = useState('school_name'); // school_name | region
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [reclaiming, setReclaiming] = useState(null);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/stale-school-groups', {
        params: { days, group_by: groupBy },
      });
      if (res.data.code === 0) {
        setGroups(res.data.data?.groups || []);
        setTotal(res.data.data?.total || 0);
      } else {
        toast?.error(res.data.msg || '加载失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupStudents = async (groupName) => {
    setExpandedLoading(true);
    try {
      const res = await api.get('/admin/stale-students', { params: { days } });
      if (res.data.code === 0) {
        const all = res.data.data || [];
        const filtered = all.filter((s) => {
          const val = groupBy === 'school_name' ? s.school_name : s.region;
          return (val || '未知') === groupName;
        });
        setExpandedStudents(filtered);
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setExpandedLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, [days, groupBy]);

  const toggleExpand = async (groupName) => {
    if (expandedGroup === groupName) {
      setExpandedGroup(null);
      setExpandedStudents([]);
    } else {
      setExpandedGroup(groupName);
      await fetchGroupStudents(groupName);
    }
  };

  const handleReclaim = async (groupName, count) => {
    const label = groupBy === 'school_name' ? '学校' : '区域';
    const ok = await confirm({
      title: '线索回收',
      message: `确定回收${label}「${groupName}」的 ${count} 名超时学员吗？\n\n回收后学员将进入未分配池（已超过 ${days} 天未跟进）。`,
      confirmText: '确认回收',
      tone: 'danger',
    });
    if (!ok) return;

    setReclaiming(groupName);
    try {
      const res = await api.post('/admin/stale-reclaim-by-group', {
        group_name: groupName,
        group_by: groupBy,
        days,
      });
      if (res.data.code === 0) {
        toast?.success(`成功回收 ${res.data.data?.reclaimed_count ?? count} 名学员，已进入未分配池`);
        setExpandedGroup(null);
        setExpandedStudents([]);
        fetchGroups();
      } else {
        toast?.error(res.data.msg || '回收失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setReclaiming(null);
    }
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setSidebarOpen(true)}>
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">线索回收</h2>
          </div>
          <button onClick={toggle} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          {/* 工具栏 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 flex flex-col lg:flex-row lg:items-center gap-3">
            <button onClick={fetchGroups} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              <RefreshCcw className="w-4 h-4" /> 刷新
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">超时天数</span>
              <input type="number" value={days} min={1} max={30}
                onChange={(e) => setDays(Number(e.target.value) || 3)}
                className="w-16 px-2 py-1.5 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 text-center" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">分组</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
                className="px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                <option value="school_name">按学校</option>
                <option value="region">按区域</option>
              </select>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              共 <span className="font-bold text-red-600">{total}</span> 名超时学员，
              涉及 <span className="font-bold">{groups.length}</span> 个{groupBy === 'school_name' ? '学校' : '区域'}
            </div>
          </div>

          {/* 分组列表 */}
          <div className="space-y-2">
            {loading ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
              </div>
            ) : groups.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center text-gray-400">
                暂无超时学员
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.name} className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => toggleExpand(g.name)}>
                      {expandedGroup === g.name
                        ? <ChevronUp className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />
                      }
                      {groupBy === 'school_name'
                        ? <School className="w-4 h-4 text-blue-500" />
                        : <MapPin className="w-4 h-4 text-amber-500" />
                      }
                      <span className="font-medium text-gray-800 dark:text-gray-100">{g.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 font-medium">
                        {g.count} 人
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReclaim(g.name, g.count); }}
                      disabled={reclaiming === g.name}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {reclaiming === g.name
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RotateCcw className="w-3.5 h-3.5" />
                      }
                      一键回收
                    </button>
                  </div>

                  {expandedGroup === g.name && (
                    <div className="border-t dark:border-gray-700">
                      {expandedLoading ? (
                        <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
                      ) : expandedStudents.length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-sm">暂无数据</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 text-xs">
                              <tr>
                                <th className="px-4 py-2 text-left">姓名</th>
                                <th className="px-4 py-2 text-left">{groupBy === 'school_name' ? '区域' : '学校'}</th>
                                <th className="px-4 py-2 text-left">意向</th>
                                <th className="px-4 py-2 text-left">话务员</th>
                                <th className="px-4 py-2 text-left">最后活动</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-gray-700/50">
                              {expandedStudents.map((s) => (
                                <tr key={s.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{s.name}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{groupBy === 'school_name' ? (s.region || '-') : (s.school_name || '-')}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.intent_level || '-'}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.agent_name || '-'}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.last_activity_at ? new Date(s.last_activity_at).toLocaleDateString() : '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
