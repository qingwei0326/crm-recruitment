/**
 * 无效线索回收管理页面
 *
 * 按无效原因筛选，再按学校分组查看；支持学校回收和勾选批量回收/删除。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Trash2,
} from 'lucide-react';

const INVALID_REASON_OPTIONS = ['', '高分段', '无意向', '孩子不想读', '空号', '其他'];

export default function InvalidStudentReclaim() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [invalidReason, setInvalidReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [schoolGroups, setSchoolGroups] = useState([]);
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [reclaimingSchool, setReclaimingSchool] = useState(null);
  const [batchAction, setBatchAction] = useState('');

  const reasonParams = useMemo(
    () => (invalidReason ? { invalid_reason: invalidReason } : {}),
    [invalidReason],
  );

  const fetchSchoolGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/invalid-school-groups', { params: reasonParams });
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
  }, [reasonParams]);

  const fetchSchoolStudents = useCallback(
    async (schoolName) => {
      setExpandedLoading(true);
      try {
        const res = await api.get('/admin/invalid-students', {
          params: { page: 1, page_size: 200, school_name: schoolName, ...reasonParams },
        });
        if (res.data.code === 0) {
          setExpandedStudents(res.data.data?.list || []);
          setSelectedIds(new Set());
        }
      } catch (e) {
        toast?.error(getApiErrorMessage(e));
      } finally {
        setExpandedLoading(false);
      }
    },
    [reasonParams],
  );

  useEffect(() => {
    setExpandedSchool(null);
    setExpandedStudents([]);
    setSelectedIds(new Set());
    fetchSchoolGroups();
  }, [fetchSchoolGroups]);

  const toggleExpand = async (schoolName) => {
    if (expandedSchool === schoolName) {
      setExpandedSchool(null);
      setExpandedStudents([]);
      setSelectedIds(new Set());
      return;
    }
    setExpandedSchool(schoolName);
    await fetchSchoolStudents(schoolName);
  };

  const refreshExpanded = async () => {
    setSelectedIds(new Set());
    if (expandedSchool) {
      await fetchSchoolStudents(expandedSchool);
    }
    await fetchSchoolGroups();
  };

  const handleReclaimSchool = async (schoolName, count) => {
    const reasonText = invalidReason ? `（原因：${invalidReason}）` : '';
    const ok = await confirm({
      title: '分学校回收',
      message: `确定回收「${schoolName}」${reasonText}的 ${count} 条无效线索吗？\n\n回收后学员将进入未分配池，不分配给任何话务员。`,
      confirmText: '确认回收',
      tone: 'danger',
    });
    if (!ok) return;

    setReclaimingSchool(schoolName);
    try {
      const res = await api.post('/admin/reclaim-by-school', {
        school_name: schoolName,
        ...(invalidReason ? { invalid_reason: invalidReason } : {}),
      });
      if (res.data.code === 0) {
        const d = res.data.data || {};
        toast?.success(`成功回收 ${d.reclaimed_count ?? count} 条线索，已进入未分配池`);
        setExpandedSchool(null);
        setExpandedStudents([]);
        setSelectedIds(new Set());
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

  const toggleStudentSelection = (studentId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleExpandedSelection = () => {
    const visibleIds = expandedStudents.map((student) => student.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(visibleIds));
  };

  const handleBatchReclaim = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: '回收到未分配池',
      message: `确定回收已选 ${ids.length} 条无效线索吗？\n\n回收后状态会重置为未联系，并清空无效原因、意向、阶段和求助标记。`,
      confirmText: '确认回收',
      tone: 'danger',
    });
    if (!ok) return;

    setBatchAction('reclaim');
    try {
      const res = await api.post('/admin/invalid-students/reclaim', { student_ids: ids });
      if (res.data.code === 0) {
        toast?.success(`成功回收 ${res.data.data?.reclaimed_count ?? ids.length} 条线索`);
        await refreshExpanded();
      } else {
        toast?.error(res.data.msg || '回收失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setBatchAction('');
    }
  };

  const handleBatchDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: '删除无效线索',
      message: `确定永久删除已选 ${ids.length} 条无效线索吗？\n\n删除会同时移除关联通话、备注、回访、到访和查看记录。`,
      confirmText: '确认删除',
      tone: 'danger',
    });
    if (!ok) return;

    setBatchAction('delete');
    try {
      const res = await api.post('/admin/invalid-students/delete', { student_ids: ids });
      if (res.data.code === 0) {
        toast?.success(`成功删除 ${res.data.data?.deleted_count ?? ids.length} 条线索`);
        await refreshExpanded();
      } else {
        toast?.error(res.data.msg || '删除失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setBatchAction('');
    }
  };

  const totalInvalid = schoolGroups.reduce((sum, g) => sum + g.count, 0);
  const visibleIds = expandedStudents.map((student) => student.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((studentId) => selectedIds.has(studentId));

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              无效线索回收
            </h2>
          </div>
          <button
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {dark ? (
              <Sun className="w-5 h-5 text-amber-400" />
            ) : (
              <Moon className="w-5 h-5 text-gray-500" />
            )}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
              <div className="flex items-center gap-3">
                <School className="w-5 h-5 text-blue-600" />
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    共 <span className="font-bold text-blue-600">{totalInvalid}</span> 条
                    {invalidReason ? `「${invalidReason}」` : ''}无效线索，涉及{' '}
                    <span className="font-bold">{schoolGroups.length}</span> 所学校
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    按原因筛选后可查看学校明细，勾选线索后回收到未分配池或删除
                  </div>
                </div>
              </div>
              <button
                onClick={fetchSchoolGroups}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <RefreshCcw className="w-4 h-4" /> 刷新
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {INVALID_REASON_OPTIONS.map((reason) => (
                <button
                  key={reason || 'all'}
                  type="button"
                  onClick={() => setInvalidReason(reason)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    invalidReason === reason
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {reason || '全部原因'}
                </button>
              ))}
            </div>
          </div>

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
                <div
                  key={g.name}
                  className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden"
                >
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    onClick={() => toggleExpand(g.name)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {expandedSchool === g.name ? (
                        <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                      <School className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="font-medium text-gray-800 dark:text-gray-100 truncate">
                        {g.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 font-medium shrink-0">
                        {g.count} 条
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReclaimSchool(g.name, g.count);
                      }}
                      disabled={reclaimingSchool === g.name}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {reclaimingSchool === g.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      一键回收
                    </button>
                  </div>

                  {expandedSchool === g.name && (
                    <div className="border-t dark:border-gray-700">
                      {expandedLoading ? (
                        <div className="p-6 text-center">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                        </div>
                      ) : expandedStudents.length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-sm">暂无数据</div>
                      ) : (
                        <>
                          <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex flex-col lg:flex-row lg:items-center gap-3">
                            <div className="text-sm text-gray-600 dark:text-gray-300 lg:mr-auto">
                              已选 {selectedIds.size} 条
                            </div>
                            <button
                              type="button"
                              onClick={handleBatchReclaim}
                              disabled={selectedIds.size === 0 || !!batchAction}
                              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              {batchAction === 'reclaim' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              回收到未分配池
                            </button>
                            <button
                              type="button"
                              onClick={handleBatchDelete}
                              disabled={selectedIds.size === 0 || !!batchAction}
                              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                            >
                              {batchAction === 'delete' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                              删除
                            </button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 text-xs">
                                <tr>
                                  <th className="px-4 py-2 text-left w-10">
                                    <input
                                      type="checkbox"
                                      checked={allVisibleSelected}
                                      onChange={toggleExpandedSelection}
                                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      aria-label="选择当前学校全部无效线索"
                                    />
                                  </th>
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
                                  <tr
                                    key={s.id}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-900/20"
                                  >
                                    <td className="px-4 py-2">
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(s.id)}
                                        onChange={() => toggleStudentSelection(s.id)}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        aria-label={`选择${s.name}`}
                                      />
                                    </td>
                                    <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">
                                      {s.name}
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                                      {s.region || '-'}
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 font-mono">
                                      {s.guardian_phone || '-'}
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                                      {s.agent_name || '-'}
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                                      <span className={s.invalid_reason ? '' : 'text-gray-400'}>
                                        {s.invalid_reason || '未填写'}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                      {formatDateTime(s.updated_at)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
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
