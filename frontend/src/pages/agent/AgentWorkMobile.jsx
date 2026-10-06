import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Phone, Menu, Sun, Moon, Plus, X, Loader2,
  AlertTriangle, StickyNote, ChevronLeft, ChevronRight,
  Target, User, History, RefreshCw, CalendarClock, Home, MapPin,
  CheckCircle2, Flame, Undo2,
} from 'lucide-react';
import api from '../../api';
import useLeadOutcomeCatalog from '../../hooks/useLeadOutcomeCatalog';
import { stageLabel, statusLabel, STAGES, INTENT_BADGES } from '../../labels';
import {
  STATUS_STYLE, inputCls, getContactOptions, quickStatusForOutcome,
} from './agentWorkUtils';
import AssignedDaysBadge from './shared/AssignedDaysBadge';
import AgentSidebar from './desktop/AgentSidebar';
import HandledView from './desktop/HandledView';
import PhoneLink from '../../components/PhoneLink';
import StudentTimeline from '../../components/StudentTimeline';
import HomeVisitForm from '../../components/admissions/HomeVisitForm';
import CampusVisitForm from '../../components/admissions/CampusVisitForm';
import { getStudentNextAction, NEXT_ACTION_TONE_CLASSES } from '../../utils/studentNextAction';
import { EmptyState, ErrorState } from '../../components/AsyncState';

export default function AgentWorkMobile({
  // State
  viewTab, setViewTab,
  students, filteredStudents, filteredStats, taskProgress, intentCounts,
  schoolGroups, selectedSchool, setSelectedSchool,
  selectedIntent, setSelectedIntent,
  currentIdx, current,
  lockedStudentId,
  showMenu, setShowMenu,
  showDetail, setShowDetail,
  detailStudent, detailLoading, detailError,
  detailCalls, detailNotes, detailFollowUps, detailVisits, detailIntentTimeline,
  detailAdmissionsTimeline,
  noteText, setNoteText,
  actionMsg,
  autoAdvanceNotice, onUndoAutoAdvance, onDismissAutoAdvance,
  // Handlers
  toggleTheme, dark,
  handleDial, updateStatus, updateStage,
  addNote,
  loadDetail, updateDetailField,
  onAdmissionsStageSynced,
  prev, next,
  toggleNeedHelp,
  onAddStudent,
  onShowSettings,
  fetchFollowing,
  followingData, followingLoading,
  // Modals
  modals,
  backlogBanner,
}) {
  const { logout } = useAuth();
  const { results: outcomeResults } = useLeadOutcomeCatalog();
  const quickStatuses = outcomeResults.map(quickStatusForOutcome);
  const [admissionForm, setAdmissionForm] = useState(null);
  const [admissionSubmitting, setAdmissionSubmitting] = useState(false);
  const currentContacts = getContactOptions(current);
  const currentNextAction = current
    ? getStudentNextAction(current, currentContacts.length > 0)
    : null;
  const progressStats = taskProgress || filteredStats || {};
  const progressed = (Number(progressStats.done) || 0) + (Number(progressStats.follow_up) || 0);
  const progress = Math.min(Math.max(Number(progressStats.progress_pct) || 0, 0), 100);
  const intentCountTotal = Object.values(intentCounts || {})
    .reduce((sum, value) => sum + (Number(value) || 0), 0);
  const allTaskCount = intentCountTotal || students.length;
  const aTaskCount = Number.isFinite(Number(intentCounts?.A))
    ? Number(intentCounts.A)
    : students.filter((student) => student.intent_level === 'A').length;
  const changeViewTab = (tab) => {
    setViewTab(tab);
    if (tab === 'following') fetchFollowing();
  };

  const submitHomeVisit = async (payload) => {
    setAdmissionSubmitting(true);
    try {
      await api.post('/admissions/home-visits', payload);
      setAdmissionForm(null);
      if (detailStudent?.id) onAdmissionsStageSynced?.(detailStudent.id, '待家访');
      if (detailStudent?.id) loadDetail(detailStudent.id);
    } finally {
      setAdmissionSubmitting(false);
    }
  };

  const submitCampusVisit = async (payload) => {
    setAdmissionSubmitting(true);
    try {
      await api.post('/admissions/campus-visits', payload);
      setAdmissionForm(null);
      if (detailStudent?.id) onAdmissionsStageSynced?.(detailStudent.id, '到校参观已安排');
      if (detailStudent?.id) loadDetail(detailStudent.id);
    } finally {
      setAdmissionSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 dark:bg-gray-950">
      <header className="sticky top-0 z-20 flex min-h-[calc(64px+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-slate-200/90 bg-white/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <div className="flex items-center gap-2.5">
          <button onClick={() => setShowMenu(true)} className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800" aria-label="打开导航">
            <Menu className="h-5 w-5 text-slate-600 dark:text-gray-300" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-3xs font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-300">
              招生运营 / 话务执行
            </div>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-bold leading-5 text-slate-900 dark:text-gray-100">话务工作台</h1>
              {viewTab === 'today' && <span className="text-xs text-gray-500">{progressed}/{progressStats.total ?? 0}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="inline-flex h-11 w-11 items-center justify-center rounded-lg" title="切换主题" aria-label="切换主题">
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
          <button onClick={onAddStudent} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500" title="手动添加学生" aria-label="手动添加学生">
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </header>
      {showMenu && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]" onClick={() => setShowMenu(false)} />
          <div className="absolute bottom-0 left-0 top-0 flex w-72 max-w-[86vw] flex-col bg-slate-950 text-white shadow-2xl">
            <AgentSidebar
              viewTab={viewTab}
              onTabChange={changeViewTab}
              onAddStudent={onAddStudent}
              onShowSettings={onShowSettings}
              dark={dark}
              onToggleTheme={toggleTheme}
              onLogout={logout}
              isMobile
              onCloseMenu={() => setShowMenu(false)}
            />
          </div>
        </div>
      )}
      {modals}
      {autoAdvanceNotice && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-3 text-gray-900 shadow-xl dark:border-emerald-900 dark:bg-gray-800 dark:text-gray-100"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {autoAdvanceNotice.message}
          </span>
          {autoAdvanceNotice.previousStudentId && (
            <button
              type="button"
              onClick={onUndoAutoAdvance}
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              返回上一位
            </button>
          )}
          <button
            type="button"
            onClick={onDismissAutoAdvance}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="关闭自动前进提示"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {viewTab === 'today' ? (
        <>
          <section className="shrink-0 border-b border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-300">
              <span>今日任务进度</span>
              <span className="tabular-nums text-blue-600 dark:text-blue-400">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-1 text-2xs text-gray-400 dark:text-gray-500">
              已推进 {progressed} / {progressStats.total ?? 0} 项任务
            </div>
          </section>
          <div className="grid shrink-0 grid-cols-4 gap-px border-b bg-gray-200 dark:border-gray-700 dark:bg-gray-700">
            {[{ label: '总任务', value: progressStats.total ?? 0 }, { label: '已推进', value: progressed },
              { label: '待首次联系', value: progressStats.pending ?? 0 }, { label: '待回访', value: progressStats.follow_up ?? 0 },
            ].map((s, i) => (
              <div key={i} className="bg-white px-1 py-2.5 text-center dark:bg-gray-800">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{s.value}</div>
                <div className="text-2xs text-gray-500 dark:text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="shrink-0 space-y-2 border-b bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800" aria-label="任务队列">
              <button
                type="button"
                onClick={() => setSelectedIntent(null)}
                aria-pressed={!selectedIntent}
                className={`flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold transition ${
                  !selectedIntent
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                全部任务 <span className="tabular-nums opacity-80">{allTaskCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedIntent(selectedIntent === 'A' ? null : 'A')}
                aria-pressed={selectedIntent === 'A'}
                className={`flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold transition ${
                  selectedIntent === 'A'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30'
                }`}
              >
                <Flame className="h-3.5 w-3.5" />
                A级优先 <span className="tabular-nums opacity-80">{aTaskCount}</span>
              </button>
            </div>
            {schoolGroups.length > 1 && (
              <select
                value={selectedSchool || ''}
                onChange={(e) => setSelectedSchool(e.target.value || null)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                aria-label="筛选学校"
              >
                <option value="">全部学校 ({students.length})</option>
                {schoolGroups.map((g) => (
                  <option key={g.name} value={g.name}>{g.name} ({g.count})</option>
                ))}
              </select>
            )}
          </div>
          {backlogBanner}
          {actionMsg && <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-4 py-2 text-center">{actionMsg}</div>}
          <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800">
            {filteredStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Target className="w-10 h-10 mb-3" /><p className="text-sm">{selectedIntent === 'A' ? '暂无 A 级优先任务' : selectedSchool ? '该学校暂无待拨打任务' : '暂无待拨打任务'}</p>
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {current && (
                  <div className={`rounded-lg border p-3 dark:border-gray-700 ${current.need_help ? 'border-red-300 bg-red-50/50 dark:border-red-700 dark:bg-red-900/10' : 'border-gray-200 bg-white shadow-sm dark:bg-gray-800'}`}>
                    <div className="mb-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="min-w-0 max-w-full truncate text-lg font-bold text-gray-900 dark:text-gray-100">{current.name}</span>
                          {current.need_help && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />需协助</span>}
                          <AssignedDaysBadge days={current.days_since_assigned} />
                        </div>
                        <div className="mt-0.5 truncate text-sm text-gray-500">{current.school_name || '未知学校'}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[current.status] || STATUS_STYLE['未联系']}`}>{statusLabel(current.status)}</span>
                        {current.status_detail && (
                          <span className="max-w-[100px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-2xs text-slate-600 dark:bg-gray-700 dark:text-gray-300">
                            {current.status_detail}
                          </span>
                        )}
                      </div>
                    </div>
                    {currentNextAction && (
                      <div className="mb-2.5">
                        <span className={`inline-flex max-w-full items-center rounded-lg border px-2.5 py-1 text-xs font-medium ${NEXT_ACTION_TONE_CLASSES[currentNextAction.tone] || NEXT_ACTION_TONE_CLASSES.slate}`}>
                          {currentNextAction.label}
                        </span>
                      </div>
                    )}
                    <div className="mb-2.5 flex items-center gap-1">
                      {STAGES.filter((s) => s !== '已报名').map((s, i) => {
                        const idx = STAGES.indexOf(current.stage);
                        return <button key={s} onClick={() => updateStage(current.id, s)} className={`flex-1 h-1.5 rounded-full transition-all ${i <= idx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'} ${s === current.stage ? 'ring-2 ring-blue-300' : ''}`} title={stageLabel(s)} />;
                      })}
                    </div>
                    {lockedStudentId === current.id && (
                      <div className="mb-2.5 rounded-lg border border-orange-300 bg-orange-50 p-2 text-center dark:border-orange-700 dark:bg-orange-900/20">
                        <div className="mb-1 flex items-center justify-center gap-1 text-xs font-bold text-orange-700 dark:text-orange-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          可继续拨联系人2，确认结果后再更新状态
                        </div>
                        <div className="text-xs text-orange-500">已联系 / 待回访 / 未接通 / 已报名</div>
                      </div>
                    )}
                    <div className="mb-2.5 grid grid-cols-3 gap-1.5">
                      {quickStatuses.map((s) => (
                        <button key={s.outcome.code} onClick={() => updateStatus(current.id, s.outcome)} className={`flex min-h-[48px] items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-center text-xs font-medium leading-tight text-white whitespace-normal ${s.color}`}>
                          <s.icon className="h-3.5 w-3.5 shrink-0" /><span>{statusLabel(s.status)}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mb-2.5 flex flex-col gap-2">
                      {currentContacts.map((contact) => (
                        <button key={contact.key} onClick={() => handleDial(contact.key, current.id)} className="flex min-h-[52px] flex-wrap items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-green-700" title={contact.phone}><Phone className="h-5 w-5 shrink-0" /> {contact.label} {contact.name}</button>
                      ))}
                      {currentContacts.length === 0 && <button disabled className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-lg bg-gray-300 py-2 text-sm font-medium text-gray-500 dark:bg-gray-700"><Phone className="h-5 w-5" /> 无联系人电话</button>}
                    </div>
                    <div className="relative flex items-center gap-2">
                      <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote(current.id)} placeholder="写备注…" className={`${inputCls} min-w-0 flex-1 !h-11 !text-base`} />
                      <button onClick={() => addNote(current.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white" title="保存备注" aria-label="保存备注"><StickyNote className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <button onClick={prev} disabled={currentIdx === 0 || lockedStudentId !== null} className="flex min-h-[44px] items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800"><ChevronLeft className="w-4 h-4" />上一条</button>
                  <span className="text-xs text-gray-500">{currentIdx + 1}/{filteredStudents.length}</span>
                  <button onClick={next} disabled={currentIdx >= filteredStudents.length - 1 || lockedStudentId !== null} className="flex min-h-[44px] items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800">下一条<ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => current && loadDetail(current.id)} disabled={lockedStudentId !== null} className="flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-gray-100 py-2 text-sm text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300"><User className="w-4 h-4" /> 学生详情</button>
                  <button onClick={toggleNeedHelp} disabled={lockedStudentId !== null} className={`flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${current?.need_help ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600'}`}><AlertTriangle className="w-4 h-4" /> {current?.need_help ? '取消协助' : '需要协助'}</button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : viewTab === 'handled' ? (
        <HandledView onOpenDetail={(id) => { loadDetail(id); setShowDetail(true); }} />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {followingLoading && !followingData ? <Loader2 className="w-6 h-6 mx-auto animate-spin" /> : followingData ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-3 gap-3 flex-1">
                  <div className="bg-white dark:bg-gray-800 rounded-panel border p-4 text-center"><div className="text-2xl font-bold text-blue-600">{followingData.total}</div><div className="text-xs text-gray-500">跟进中</div></div>
                  {followingData.intent_counts && Object.entries(followingData.intent_counts).filter(([k]) => k !== '无').map(([level, count]) => (
                    <div key={level} className="bg-white dark:bg-gray-800 rounded-panel border p-4 text-center"><div className="text-2xl font-bold text-amber-600">{count}</div><div className="text-xs text-gray-500">{level}级意向</div></div>
                  ))}
                </div>
                <button onClick={fetchFollowing} disabled={followingLoading} className="ml-2 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <RefreshCw className={`w-4 h-4 ${followingLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {followingData.list?.length > 0 ? (
                <div className="space-y-2">
                  {followingData.list.map((item) => (
                    <button key={item.id} onClick={() => { loadDetail(item.id); setShowDetail(true); }}
                      className="w-full text-left bg-white dark:bg-gray-800 rounded-panel border p-3 active:bg-gray-50 dark:active:bg-gray-700">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INTENT_BADGES[item.intent_level] || INTENT_BADGES['无']}`}>{item.intent_level}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[item.status] || ''}`}>{statusLabel(item.status)}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{item.school_name || '未知学校'} · {item.region || '-'}</div>
                        </div>
                        <AssignedDaysBadge days={item.days_since_assigned} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState bare title="暂无跟进中学员" />
              )}
            </div>
          ) : <ErrorState bare title="加载失败" message="跟进中学员加载失败，请稍后重试。" />}
        </div>
      )}
      {showDetail && detailStudent && (
        <div className="fixed inset-0 z-40 flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="font-semibold">{detailStudent.name}</h3>
            <button onClick={() => setShowDetail(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 dark:text-gray-300" aria-label="关闭学生详情"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {detailLoading && <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg"><Loader2 className="w-3.5 h-3.5 animate-spin" />加载学生详情...</div>}
            {detailError && <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /><span className="flex-1">{detailError}</span><button onClick={() => loadDetail(detailStudent.id)} className="font-medium">重试</button></div>}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <div className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">意向等级（手动评级）</div>
              <div className="flex gap-2">{['A', 'B', 'C', '无'].map((level) => (
                <button key={level} onClick={() => updateDetailField('intent_level', level)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${detailStudent.intent_level === level ? (level === 'A' ? 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300' : level === 'B' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300' : level === 'C' ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200' : 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400') : 'bg-white border dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{level === '无' ? '无' : `${level}级`}</button>
              ))}</div>
            </div>
            <section className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-3">
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">招生推进</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">家访申请 / 到校预约</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAdmissionForm(admissionForm === 'home' ? null : 'home')} className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white">
                    <Home className="w-3.5 h-3.5" />申请家访
                  </button>
                  <button type="button" onClick={() => setAdmissionForm(admissionForm === 'campus' ? null : 'campus')} className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white">
                    <MapPin className="w-3.5 h-3.5" />预约到校
                  </button>
                </div>
              </div>
              {admissionForm === 'home' && (
                <HomeVisitForm
                  student={detailStudent}
                  submitting={admissionSubmitting}
                  onSubmit={submitHomeVisit}
                  onCancel={() => setAdmissionForm(null)}
                />
              )}
              {admissionForm === 'campus' && (
                <CampusVisitForm
                  student={detailStudent}
                  submitting={admissionSubmitting}
                  onSubmit={submitCampusVisit}
                  onCancel={() => setAdmissionForm(null)}
                />
              )}
            </section>
            {[
              ['score', '成绩'],
              ['guardian_name', '监护人'],
              ['guardian_phone', '监护人电话', 'guardian'],
              ['guardian2_name', '监护人2'],
              ['guardian2_phone', '监护人2电话', 'guardian2'],
              ['school_name', '学校'],
            ].map(([k, label, contactKey]) => (
              <div key={k} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                <div className="mt-0.5 font-medium text-gray-900 dark:text-gray-100">
                  {contactKey ? (
                    <PhoneLink
                      value={detailStudent[k]}
                      label={`拨打${label}`}
                      onDial={() => handleDial(contactKey, detailStudent.id)}
                    />
                  ) : (
                    detailStudent[k] || '-'
                  )}
                </div>
              </div>
            ))}
            <div className="pt-2 border-t dark:border-gray-700">
              <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">完整时间线</div>
              <StudentTimeline
                student={detailStudent}
                calls={detailCalls}
                notes={detailNotes}
                followUps={detailFollowUps}
                visits={detailVisits}
                intentTimeline={detailIntentTimeline}
                admissionsTimeline={detailAdmissionsTimeline}
              />
            </div>
          </div>
        </div>
      )}
      {/* Bottom tab bar */}
      <div className="sticky bottom-0 z-20 flex border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <button onClick={() => changeViewTab('today')} className={`flex min-h-12 flex-1 flex-col items-center justify-center py-2 ${viewTab === 'today' ? 'text-emerald-600' : 'text-gray-400'}`}>
          <Target className="w-5 h-5" /><span className="text-3xs mt-0.5">待拨打</span>
        </button>
        <button onClick={() => changeViewTab('handled')} className={`flex min-h-12 flex-1 flex-col items-center justify-center py-2 ${viewTab === 'handled' ? 'text-emerald-600' : 'text-gray-400'}`}>
          <CalendarClock className="w-5 h-5" /><span className="text-3xs mt-0.5">待处理</span>
        </button>
        <button onClick={() => changeViewTab('following')} className={`flex min-h-12 flex-1 flex-col items-center justify-center py-2 ${viewTab === 'following' ? 'text-emerald-600' : 'text-gray-400'}`}>
          <History className="w-5 h-5" /><span className="text-3xs mt-0.5">跟进中</span>
        </button>
      </div>
    </div>
  );
}
