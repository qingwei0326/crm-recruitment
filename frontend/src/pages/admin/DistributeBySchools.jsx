/**
 * 多学校分发页面
 *
 * 按学校展示未分配学员，勾选学校后一键分发给话务员。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { getApiErrorMessage } from '../../utils';
import {
  Loader2, Menu, Sun, Moon, RefreshCcw,
  ChevronDown, ChevronUp,
  Send, School, CheckSquare, Square, MapPin,
} from 'lucide-react';

const UNKNOWN_REGION = '未知区县';

function normalizeRegion(region) {
  return String(region || '').trim() || UNKNOWN_REGION;
}

function buildRegionGroups(groups) {
  const byRegion = new Map();
  groups.forEach((group) => {
    const region = normalizeRegion(group.region);
    if (!byRegion.has(region)) {
      byRegion.set(region, { name: region, count: 0, schools: [] });
    }
    const item = byRegion.get(region);
    item.count += Number(group.count || 0);
    item.schools.push({ ...group, region });
  });
  return [...byRegion.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export default function DistributeBySchools() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [schoolGroups, setSchoolGroups] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState(new Set());
  const [expandedRegions, setExpandedRegions] = useState(new Set());
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [agents, setAgents] = useState([]);
  const [mode, setMode] = useState('auto'); // auto | manual
  const [targetAgentId, setTargetAgentId] = useState('');

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/unassigned-school-groups');
      if (res.data.code === 0) {
        const groups = res.data.data?.groups || [];
        setSchoolGroups(groups);
        setExpandedRegions(new Set(buildRegionGroups(groups).map((g) => g.name)));
        setSelectedSchools((prev) => {
          const currentNames = new Set(groups.map((g) => g.name));
          return new Set([...prev].filter((name) => currentNames.has(name)));
        });
      } else {
        toast?.error(res.data.msg || '加载失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await api.get('/admin/agents');
      if (res.data.code === 0) setAgents(res.data.data || []);
    } catch {}
  };

  const fetchSchoolStudents = async (schoolName) => {
    setExpandedLoading(true);
    try {
      const res = await api.get('/students', {
        params: { page: 1, page_size: 200, school_name: schoolName, assignment: 'unassigned' },
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

  useEffect(() => { fetchGroups(); fetchAgents(); }, []);

  const regionGroups = useMemo(() => buildRegionGroups(schoolGroups), [schoolGroups]);

  const allSchoolsSelected = schoolGroups.length > 0
    && schoolGroups.every((g) => selectedSchools.has(g.name));

  const toggleSchool = (name) => {
    setSelectedSchools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSchoolsSelected) {
      setSelectedSchools(new Set());
    } else {
      setSelectedSchools(new Set(schoolGroups.map((g) => g.name)));
    }
  };

  const toggleRegion = (regionGroup) => {
    setSelectedSchools((prev) => {
      const next = new Set(prev);
      const schoolNames = regionGroup.schools.map((school) => school.name);
      const allSelected = schoolNames.every((name) => next.has(name));
      schoolNames.forEach((name) => {
        if (allSelected) next.delete(name);
        else next.add(name);
      });
      return next;
    });
  };

  const toggleRegionExpand = (regionName) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(regionName)) next.delete(regionName);
      else next.add(regionName);
      return next;
    });
  };

  const toggleExpand = async (schoolName) => {
    if (expandedSchool === schoolName) {
      setExpandedSchool(null);
      setExpandedStudents([]);
    } else {
      setExpandedSchool(schoolName);
      await fetchSchoolStudents(schoolName);
    }
  };

  const handleDistribute = async () => {
    if (selectedSchools.size === 0) {
      toast?.warning('请先选择学校');
      return;
    }
    if (mode === 'manual' && !targetAgentId) {
      toast?.warning('请选择目标话务员');
      return;
    }
    const totalStudents = schoolGroups
      .filter((g) => selectedSchools.has(g.name))
      .reduce((sum, g) => sum + g.count, 0);
    const agentName = mode === 'manual'
      ? agents.find((a) => String(a.id) === String(targetAgentId))?.name || '该话务员'
      : '所有话务员（按负载均衡）';

    const ok = await confirm({
      title: '多学校分发',
      message: `确定将 ${selectedSchools.size} 所学校的 ${totalStudents} 名未分配学员分发给「${agentName}」吗？`,
      confirmText: '确认分发',
    });
    if (!ok) return;

    setDistributing(true);
    try {
      const payload = {
        school_names: [...selectedSchools],
        mode,
      };
      if (mode === 'manual') payload.agent_id = Number(targetAgentId);
      const res = await api.post('/admin/distribute-by-schools', payload);
      if (res.data.code === 0) {
        const d = res.data.data || {};
        const distStr = Object.entries(d.distribution || {}).map(([k, v]) => `${k}:${v}`).join('、');
        toast?.success(`成功分发 ${d.distributed_count} 名学员：${distStr}`);
        setSelectedSchools(new Set());
        fetchGroups();
      } else {
        toast?.error(res.data.msg || '分发失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setDistributing(false);
    }
  };

  const totalUnassigned = schoolGroups.reduce((sum, g) => sum + g.count, 0);
  const selectedCount = schoolGroups
    .filter((g) => selectedSchools.has(g.name))
    .reduce((sum, g) => sum + g.count, 0);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <header
          className={`sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 flex justify-between ${
            isMobile ? 'items-end pb-2' : 'h-14 items-center'
          }`}
          style={
            isMobile
              ? {
                  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                  minHeight: 'calc(env(safe-area-inset-top, 0px) + 64px)',
                }
              : undefined
          }
        >
          <div className="flex min-h-10 items-center gap-3">
            {isMobile && (
              <button
                className="inline-flex min-w-10 min-h-10 -ml-2 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开导航"
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">多学校分发</h2>
          </div>
          <button
            onClick={toggle}
            className="inline-flex min-w-10 min-h-10 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={dark ? '亮色模式' : '暗色模式'}
          >
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          {/* 工具栏 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <button onClick={fetchGroups} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                <RefreshCcw className="w-4 h-4" /> 刷新
              </button>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                共 <span className="font-bold text-blue-600">{totalUnassigned}</span> 名未分配学员，
                <span className="font-bold text-blue-600">{regionGroups.length}</span> 个区县，
                已选 <span className="font-bold text-green-600">{selectedCount}</span> 名
              </div>
              <div className="flex-1" />
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                {/* 分发模式 */}
                <div className="flex items-center gap-2">
                  <select value={mode} onChange={(e) => setMode(e.target.value)}
                    className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="auto">自动均衡分发</option>
                    <option value="manual">指定话务员</option>
                  </select>
                  {mode === 'manual' && (
                    <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)}
                      className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 min-w-[120px]">
                      <option value="">选择话务员</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </div>
                <button
                  onClick={handleDistribute}
                  disabled={distributing || selectedSchools.size === 0}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-green-700"
                >
                  {distributing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  分发所选学校
                </button>
              </div>
            </div>
          </div>

          {/* 学校列表 */}
          <div className="space-y-2">
            {loading ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
              </div>
            ) : schoolGroups.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center text-gray-400">
                暂无未分配学员
              </div>
            ) : (
              <>
                {/* 全选 */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={toggleAll}>
                  {allSchoolsSelected
                    ? <CheckSquare className="w-4 h-4 text-green-600" />
                    : <Square className="w-4 h-4 text-gray-400" />
                  }
                  <span className="text-sm text-gray-600 dark:text-gray-400">全选所有学校</span>
                </div>

                {regionGroups.map((region) => {
                  const isRegionExpanded = expandedRegions.has(region.name);
                  const selectedInRegion = region.schools.filter((school) => selectedSchools.has(school.name)).length;
                  const allRegionSelected = selectedInRegion === region.schools.length;

                  return (
                    <div key={region.name} className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900/30">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => toggleRegion(region)}
                            aria-label={`选择${region.name}全部学校`}
                          >
                            {allRegionSelected
                              ? <CheckSquare className="w-4 h-4 text-green-600" />
                              : <Square className="w-4 h-4 text-gray-400" />
                            }
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleRegionExpand(region.name)}
                            className="inline-flex items-center justify-center"
                            aria-label={isRegionExpanded ? `收起${region.name}` : `展开${region.name}`}
                          >
                            {isRegionExpanded
                              ? <ChevronUp className="w-4 h-4 text-gray-400" />
                              : <ChevronDown className="w-4 h-4 text-gray-400" />
                            }
                          </button>
                          <MapPin className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">{region.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium shrink-0">
                            {region.count} 人
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                            {region.schools.length} 所学校
                          </span>
                          {selectedInRegion > 0 && (
                            <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
                              已选 {selectedInRegion} 所
                            </span>
                          )}
                        </div>
                      </div>

                      {isRegionExpanded && (
                        <div className="divide-y dark:divide-gray-700">
                          {region.schools.map((g) => (
                            <div key={g.name}>
                              <div className="flex items-center justify-between px-4 py-3">
                                <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={() => toggleExpand(g.name)}>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); toggleSchool(g.name); }}>
                                    {selectedSchools.has(g.name)
                                      ? <CheckSquare className="w-4 h-4 text-green-600" />
                                      : <Square className="w-4 h-4 text-gray-400" />
                                    }
                                  </button>
                                  {expandedSchool === g.name
                                    ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                                    : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                                  }
                                  <School className="w-4 h-4 text-blue-500 shrink-0" />
                                  <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{g.name}</span>
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium shrink-0">
                                    {g.count} 人
                                  </span>
                                </div>
                              </div>

                              {expandedSchool === g.name && (
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
                                            <th className="px-4 py-2 text-left">地区</th>
                                            <th className="px-4 py-2 text-left">成绩</th>
                                            <th className="px-4 py-2 text-left">监护人</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y dark:divide-gray-700/50">
                                          {expandedStudents.map((s) => (
                                            <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                                              <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{s.name}</td>
                                              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.region || '-'}</td>
                                              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.score ?? '-'}</td>
                                              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.guardian_name || '-'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
