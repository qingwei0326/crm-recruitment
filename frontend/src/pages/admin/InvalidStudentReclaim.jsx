/**
 * 无效线索回收管理页面 — 分学校回收模式
 *
 * 按学校分组展示无效线索，一键回收整个学校 → assigned_to=null（未分配池）。
 */

import { useEffect, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import {
  Loader2,
  Menu,
  Sun,
  Moon,
  RefreshCcw,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  School,
} from 'lucide-react';

export default function InvalidStudentReclaim() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [schoolGroups, setSchoolGroups] = useState([]);
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [reclaimingSchool, setReclaimingSchool] = useState(null);

  const fetchSchoolGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/invalid-school-groups');
      if (res.data.code === 0) {
        setSchoolGroups(res.data.data?.groups || []);
      } else {
        toast?.error(res.data.msg || '加载失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchSchoolStudents = async (schoolName) => {
    setExpandedLoading(true);
    try {
      const res = await api.get('/admin/invalid-students', {
        params: { page: 1, page_size: 200, school_name: schoolName },
      });
      if (res.data.code === 0) {
        setExpandedStudents(res.data.data?.list || []);
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setExpandedLoading(false);
    }
  };

  useEffect(() => { fetchSchoolGroups(); }, []);

  const toggleExpand = async (schoolName) => {
    if (expandedSchool === schoolName) {
      setExpandedSchool(null);
      setExpandedStudents([]);
    } else {
      setExpandedSchool(schoolName);
      await fetchSchoolStudents(schoolName);
    }
  };

  const handleReclaimSchool = async (schoolName, count) => {
    const ok = await confirm({
      title: '分学校回收',
      message: `确定回收「${schoolName}」的 ${count} 条无效线索吗？\n\n回收后学员将进入未分配池，不分配给任何话务员。`,
      confirmText: '确认回收',
      tone: 'danger',
    });
    if (!ok) return;

    setReclaimingSchool(schoolName);
    try {
      const res = await api.post('/admin/reclaim-by-school', { school_name: schoolName });
      if (res.data.code === 0) {
        const d = res.data.data || {};
        toast?.success(`成功回收 ${d.reclaimed_count ?? count} 条线索，已进入未分配池`);
        setExpandedSchool(null);
        setExpandedStudents([]);
        fetchSchoolGroups();
      } else {
        toast?.error(res.data.msg || '回收失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setReclaimingSchool(null);
    }
  };

  const totalInvalid = schoolGroups.reduce((sum, g) => sum + g.count, 0);

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
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">无效线索回收</h2>
          </div>
          <button onClick={toggle} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          {/* 概览 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <School className="w-5 h-5 text-blue-600" />
              <div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  共 <span className="font-bold text-blue-600">{totalInvalid}</span> 条无效线索，
                  涉及 <span className="font-bold">{schoolGroups.length}</span> 所学校
                </div>
                <div className="text-xs text-gray-500 mt-0.5">点击学校可查看详情，一键回收进入未分配池</div>
              </div>
            </div>
            <button
              onClick={fetchSchoolGroups}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <RefreshCcw className="w-4 h-4" /> 刷新
            </button>
          </div>

          {/* 学校分组列表 */}
          <div className="space-y-2">
            {loading ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
              </div>
            ) : schoolGroups.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center text-gray-400">
                暂无无效线索
              </div>
            ) : (
              schoolGroups.map((g) => (
                <div key={g.name} className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
                  {/* 学校行 */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    onClick={() => toggleExpand(g.name)}
                  >
                    <div className="flex items-center gap-3">
                      {expandedSchool === g.name
                        ? <ChevronUp className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />
                      }
                      <School className="w-4 h-4 text-blue-500" />
                      <span className="font-medium text-gray-800 dark:text-gray-100">{g.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 font-medium">
                        {g.count} 条
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReclaimSchool(g.name, g.count); }}
                      disabled={reclaimingSchool === g.name}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {reclaimingSchool === g.name
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RotateCcw className="w-3.5 h-3.5" />
                      }
                      一键回收
                    </button>
                  </div>

                  {/* 展开的学生列表 */}
                  {expandedSchool === g.name && (
                    <div className="border-t dark:border-gray-700">
                      {expandedLoading ? (
                        <div className="p-6 text-center">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                        </div>
                      ) : expandedStudents.length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-sm">暂无数据</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 text-xs">
                              <tr>
                                <th className="px-4 py-2 text-left">姓名</th>
                                <th className="px-4 py-2 text-left">地区</th>
                                <th className="px-4 py-2 text-left">电话尾号</th>
                                <th className="px-4 py-2 text-left">原话务员</th>
                                <th className="px-4 py-2 text-left">无效原因</th>
                                <th className="px-4 py-2 text-left">更新时间</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-gray-700/50">
                              {expandedStudents.map((s) => (
                                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{s.name}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.region || '-'}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400 font-mono">{s.guardian_phone || '-'}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.agent_name || '-'}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                                    <span className={s.invalid_reason ? '' : 'text-gray-400'}>{s.invalid_reason || '未填写'}</span>
                                  </td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{formatDateTime(s.updated_at)}</td>
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
