import { useAuth } from '../../context/AuthContext';
import {
  Phone, Sparkles, Menu, Sun, Moon, Plus, X, Loader2,
  AlertTriangle, StickyNote, ChevronLeft, ChevronRight,
  Target, User, History, RefreshCw,
} from 'lucide-react';
import { stageLabel, statusLabel, STAGES, INTENT_BADGES } from '../../labels';
import { formatDateTime } from '../../utils';
import {
  STATUS_STYLE, QUICK_STATUSES, inputCls, getContactOptions,
} from './agentWorkUtils';
import AssignedDaysBadge from './shared/AssignedDaysBadge';
import AiPanel from './AiPanel';
import AgentSidebar from './desktop/AgentSidebar';

export default function AgentWorkMobile({
  // State
  viewTab, setViewTab,
  students, filteredStudents, filteredStats,
  schoolGroups, selectedSchool, setSelectedSchool,
  currentIdx, setCurrentIdx, current,
  prediction, lockedStudentId,
  showMenu, setShowMenu,
  showCreate, setShowCreate, createErr, setCreateErr,
  showDetail, setShowDetail,
  detailStudent, detailLoading, detailError,
  detailNotes, detailNotesError, noteIdx, setNoteIdx,
  hasAnalysis,
  showAi, setShowAi, activeStudent,
  noteText, setNoteText,
  actionMsg,
  dialCheckByStudent,
  // Handlers
  toggleTheme, dark,
  handleDial, updateStatus, updateStage,
  addNote, openAiPanel,
  loadDetail, updateDetailField,
  prev, next,
  toggleNeedHelp,
  fetchFollowing,
  followingData, followingLoading,
  // Modals
  modals,
  backlogBanner,
}) {
  const { logout } = useAuth();

  const Sidebar = () => (
    <AgentSidebar
      viewTab={viewTab} onTabChange={setViewTab}
      onAddStudent={() => { setShowCreate(true); setCreateErr(''); }}
      onShowSettings={() => {}}
      dark={dark} onToggleTheme={toggleTheme} onLogout={logout}
      isMobile={true} onCloseMenu={() => setShowMenu(false)}
    />
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <button onClick={() => setShowMenu(true)} className="p-2 -ml-2">
            <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">话务工作台</h1>
          {viewTab === 'today' && <span className="text-xs text-gray-500">{filteredStats.done}/{filteredStats.total}</span>}
        </div>
        <button onClick={toggleTheme} className="p-2 rounded-lg">
          {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
        </button>
        <button onClick={() => { setShowCreate(true); setCreateErr(''); }} className="p-2 rounded-lg text-gray-500" title="手动添加学生">
          <Plus className="w-5 h-5" />
        </button>
      </header>
      {showMenu && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMenu(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-gray-800 shadow-2xl flex flex-col">
            <Sidebar />
          </div>
        </div>
      )}
      {modals}
      {viewTab === 'today' ? (
        <>
          <div className="grid grid-cols-4 gap-px bg-gray-200 dark:bg-gray-700 shrink-0">
            {[{ label: '总数', value: filteredStats.total }, { label: '完成', value: filteredStats.done },
              { label: '待联', value: filteredStats.pending }, { label: '回访', value: filteredStats.follow_up },
            ].map((s, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 px-2 py-3 text-center">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{s.value}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
          {schoolGroups.length > 1 && (
            <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <button onClick={() => setSelectedSchool(null)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition ${!selectedSchool ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'}`}>
                全部 {students.length}
              </button>
              {schoolGroups.map((g) => (
                <button key={g.name} onClick={() => setSelectedSchool(selectedSchool === g.name ? null : g.name)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition ${selectedSchool === g.name ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'}`}>
                  {g.name} {g.count}
                </button>
              ))}
            </div>
          )}
          {backlogBanner}
          {actionMsg && <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-4 py-2 text-center">{actionMsg}</div>}
          <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800">
            {filteredStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Target className="w-10 h-10 mb-3" /><p className="text-sm">{selectedSchool ? '该学校暂无任务' : '暂无今日任务'}</p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {current && (
                  <div className={`rounded-xl border dark:border-gray-700 p-4 ${current.need_help ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-lg text-gray-900 dark:text-gray-100">{current.name}</span>
                          {current.need_help && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />需协助</span>}
                          <AssignedDaysBadge days={current.days_since_assigned} />
                        </div>
                        <div className="text-sm text-gray-500 font-mono mt-0.5">{current.school_name || '未知学校'}</div>
                        {prediction && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-xs text-gray-500">报名概率</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${prediction.conversion_probability >= 0.7 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : prediction.conversion_probability >= 0.4 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'}`}>
                              {(prediction.conversion_probability * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[current.status] || STATUS_STYLE['未联系']}`}>{statusLabel(current.status)}</span>
                    </div>
                    <div className="flex items-center gap-1 mb-3">
                      {STAGES.map((s, i) => {
                        const idx = STAGES.indexOf(current.stage);
                        return <button key={s} onClick={() => updateStage(current.id, s)} className={`flex-1 h-1.5 rounded-full transition-all ${i <= idx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'} ${s === current.stage ? 'ring-2 ring-blue-300' : ''}`} title={stageLabel(s)} />;
                      })}
                    </div>
                    {lockedStudentId === current.id && (
                      <div className="mb-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg text-center">
                        <div className="text-sm font-bold text-orange-700 dark:text-orange-300 mb-1">⚠ 可继续拨联系人2，确认结果后再更新状态</div>
                        <div className="text-xs text-orange-500">已联系 / 待回访 / 未接通 / 已报名</div>
                      </div>
                    )}
                    <div className="flex gap-2 mb-3">
                      {QUICK_STATUSES.map((s) => (
                        <button key={s.status} onClick={() => updateStatus(current.id, s.status)} className={`flex items-center gap-1 px-3 py-2 text-white rounded-lg text-xs font-medium ${s.color}`}>
                          <s.icon className="w-3.5 h-3.5" />{statusLabel(s.status)}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                      {getContactOptions(current).map((contact) => {
                        const dc = dialCheckByStudent[current.id]; const cnt = dc?.count ?? 0; const warn = cnt >= 3;
                        return <button key={contact.key} onClick={() => handleDial(contact.key, current.id)} className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-white ${warn ? 'bg-red-600 hover:bg-red-700 ring-2 ring-red-300 dark:ring-red-700' : 'bg-green-600 hover:bg-green-700'}`} title={contact.phone}><Phone className="w-4 h-4" /> {contact.label} {contact.name}{dc && <span className="text-[10px] opacity-90">(24h 已 {cnt} 次)</span>}</button>;
                      })}
                      {getContactOptions(current).length === 0 && <button disabled className="flex items-center justify-center gap-1.5 py-2.5 bg-gray-300 dark:bg-gray-700 text-gray-500 rounded-lg text-sm font-medium"><Phone className="w-4 h-4" /> 无联系人电话</button>}
                      <button onClick={() => openAiPanel(current)} disabled={lockedStudentId === current.id} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"><Sparkles className="w-4 h-4" /> AI分析</button>
                    </div>
                    <div className="flex gap-2 relative">
                      <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="写备注…" className={`flex-1 ${inputCls}`} />
                      <button onClick={() => addNote()} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"><StickyNote className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <button onClick={prev} disabled={currentIdx === 0 || lockedStudentId !== null} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一条</button>
                  <span className="text-xs text-gray-500">{currentIdx + 1}/{filteredStudents.length}</span>
                  <button onClick={next} disabled={currentIdx >= filteredStudents.length - 1 || lockedStudentId !== null} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 disabled:opacity-30">下一条<ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => current && loadDetail(current.id)} disabled={lockedStudentId !== null} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"><User className="w-4 h-4" /> 学生详情</button>
                  <button onClick={toggleNeedHelp} disabled={lockedStudentId !== null} className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed ${current?.need_help ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600'}`}><AlertTriangle className="w-4 h-4" /> {current?.need_help ? '取消协助' : '需要协助'}</button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {followingLoading && !followingData ? <Loader2 className="w-6 h-6 mx-auto animate-spin" /> : followingData ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-3 gap-3 flex-1">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center"><div className="text-2xl font-bold text-blue-600">{followingData.total}</div><div className="text-xs text-gray-500">跟进中</div></div>
                  {followingData.intent_counts && Object.entries(followingData.intent_counts).filter(([k]) => k !== '无').map(([level, count]) => (
                    <div key={level} className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center"><div className="text-2xl font-bold text-amber-600">{count}</div><div className="text-xs text-gray-500">{level}级意向</div></div>
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
                      className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border p-3 active:bg-gray-50 dark:active:bg-gray-700">
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
                <div className="text-center text-gray-400 py-8">暂无跟进中学员</div>
              )}
            </div>
          ) : <div className="text-center text-gray-400">加载失败</div>}
        </div>
      )}
      {showDetail && detailStudent && (
        <div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 flex flex-col">
          <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold">{detailStudent.name}</h3>
            <button onClick={() => setShowDetail(false)}><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {detailLoading && <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg"><Loader2 className="w-3.5 h-3.5 animate-spin" />加载学生详情...</div>}
            {detailError && <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /><span className="flex-1">{detailError}</span><button onClick={() => loadDetail(detailStudent.id)} className="font-medium">重试</button></div>}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1.5">意向等级（手动评级）</div>
              <div className="flex gap-2">{['A', 'B', 'C', '无'].map((level) => (
                <button key={level} onClick={() => updateDetailField('intent_level', level)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${detailStudent.intent_level === level ? (level === 'A' ? 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300' : level === 'B' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300' : level === 'C' ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200' : 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400') : 'bg-white border dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{level === '无' ? '无' : `${level}级`}</button>
              ))}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-gray-500">AI分析状态</span>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${hasAnalysis ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>{hasAnalysis ? '✓ AI分析已完成' : '暂未分析'}</span>
            </div>
            {[['score', '成绩'], ['guardian_name', '监护人'], ['guardian_phone', '监护人电话'], ['guardian2_name', '监护人2'], ['guardian2_phone', '监护人2电话'], ['school_name', '学校']].map(([k, label]) => (
              <div key={k} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3"><div className="text-xs text-gray-500">{label}</div><div className="font-medium mt-0.5">{detailStudent[k] || '-'}</div></div>
            ))}
            <div className="pt-2 border-t dark:border-gray-700">
              <div className="text-sm font-semibold mb-2">联系记录</div>
              {detailNotesError && <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">联系记录加载失败：{detailNotesError}</div>}
              {detailNotes.length === 0 ? <div className="text-xs text-gray-400 py-4 text-center">暂无</div> : (
                <>
                  <div className="flex gap-3 py-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-blue-600" /></div>
                    <div>
                      <div className="flex items-center gap-2">
                        {detailNotes[noteIdx].source === 'ai' && <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">AI</span>}
                        <span className="text-xs font-medium">{detailNotes[noteIdx].agent_name}</span>
                        <span className="text-xs text-gray-400">{formatDateTime(detailNotes[noteIdx].created_at)}</span>
                      </div>
                      <div className="text-sm mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{detailNotes[noteIdx].content}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <button onClick={() => setNoteIdx(noteIdx - 1)} disabled={noteIdx === 0} className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" />上一条</button>
                    <span className="text-xs text-gray-400">{noteIdx + 1}/{detailNotes.length}</span>
                    <button onClick={() => setNoteIdx(noteIdx + 1)} disabled={noteIdx >= detailNotes.length - 1} className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30">下一条<ChevronRight className="w-3.5 h-3.5" /></button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showAi && activeStudent && (
        <div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 flex flex-col">
          <AiPanel activeStudent={activeStudent} onClose={() => setShowAi(false)} onStatusUpdate={updateStatus} />
        </div>
      )}
      {/* Bottom tab bar */}
      <div className="sticky bottom-0 z-20 bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex">
        <button onClick={() => setViewTab('today')} className={`flex-1 flex flex-col items-center py-2 ${viewTab === 'today' ? 'text-green-600' : 'text-gray-400'}`}>
          <Target className="w-5 h-5" /><span className="text-[10px] mt-0.5">今日任务</span>
        </button>
        <button onClick={() => { setViewTab('following'); fetchFollowing(); }} className={`flex-1 flex flex-col items-center py-2 ${viewTab === 'following' ? 'text-green-600' : 'text-gray-400'}`}>
          <History className="w-5 h-5" /><span className="text-[10px] mt-0.5">跟进中</span>
        </button>
      </div>
    </div>
  );
}
