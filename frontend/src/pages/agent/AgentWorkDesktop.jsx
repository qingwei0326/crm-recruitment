import { useMemo } from 'react';
import { Phone, HelpCircle, Plus } from 'lucide-react';
import AgentSidebar from './desktop/AgentSidebar';
import FilterPanel from './desktop/FilterPanel';
import StatsBar from './desktop/StatsBar';
import StudentTable from './desktop/StudentTable';
import PaginationBar from './desktop/PaginationBar';
import FollowingView from './desktop/FollowingView';
import HandledView from './desktop/HandledView';
import StudentDetailDrawer from './desktop/StudentDetailDrawer';
import { STAGES } from '../../labels';

export default function AgentWorkDesktop({
  user, dark, toggleTheme, logout,
  viewTab, setViewTab,
  students, filteredStudents, filteredStats, taskProgress, intentCounts, schoolGroups,
  currentIdx, setCurrentIdx,
  expandedId, setExpandedId,
  sortConfig, setSortConfig,
  selectedSchool, setSelectedSchool,
  selectedStage, setSelectedStage,
  selectedIntent, setSelectedIntent,
  scoreRange, setScoreRange,
  selectedStatus, setSelectedStatus,
  searchQuery, setSearchQuery,
  backlogBanner,
  fetchFollowing, followingData, followingLoading,
  onHelpOpen, onAddStudent, onShowSettings,
  modals,
  actionMsg,
  noteText, setNoteText,
  lockedStudentId,
  handleDial, updateStatus, updateStage, addNote, updateScore,
  detailLoading, detailError, detailCalls, detailNotes, detailFollowUps, detailVisits,
  detailIntentTimeline, detailAdmissionsTimeline, updateDetailField,
  showDetail, detailStudent,
  setShowDetail, loadDetail,
  onAdmissionsStageSynced,
}) {
  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedStudents = useMemo(() => {
    return [...filteredStudents].sort((a, b) => {
      const { key, direction } = sortConfig;
      if (!key) return 0;
      const getVal = (s) => {
        switch (key) {
          case 'name': return s.name || '';
          case 'school_name': return s.school_name || '';
          case 'stage': return STAGES.indexOf(s.stage);
          case 'intent_level': return s.intent_level === '无' ? -1 : (s.intent_level === 'A' ? 0 : s.intent_level === 'B' ? 1 : 2);
          case 'status': return s.status || '';
          case 'days': return s.days_since_assigned ?? 999;
          default: return '';
        }
      };
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredStudents, sortConfig]);
  const progressedTaskCount = (Number(taskProgress?.done) || 0) + (Number(taskProgress?.follow_up) || 0);
  const progressTaskTotal = taskProgress?.total ?? filteredStats.total;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {modals}
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col bg-slate-950 text-white">
        <div className="flex items-center gap-3 border-b border-slate-800/90 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 shadow-lg shadow-emerald-950/30">
            <Phone className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-wide text-white">招生话务 CRM</div>
            <div className="mt-0.5 truncate text-[10px] font-medium text-slate-500">话务执行工作台 · {user?.name || '坐席'}</div>
          </div>
        </div>
        <AgentSidebar
          viewTab={viewTab}
          onTabChange={(tab) => { setViewTab(tab); if (tab === 'following') fetchFollowing(); }}
          onAddStudent={onAddStudent}
          onShowSettings={onShowSettings}
          dark={dark}
          onToggleTheme={toggleTheme}
          onLogout={logout}
        />
      </aside>

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/90 bg-white/95 px-5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-300">
              招生运营 / 话务执行
            </div>
            <h2 className="truncate text-base font-bold leading-5 text-slate-900 dark:text-gray-100">
              {viewTab === 'today' ? '待拨打任务' : viewTab === 'handled' ? '待处理线索' : '跟进中学生'}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">
              {viewTab === 'today' ? '今日分配任务' : viewTab === 'handled' ? '已产生联系结果的线索' : '需要持续推进的学生'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onHelpOpen}
              className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="使用说明"
              aria-label="使用说明"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              onClick={onAddStudent}
              className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
              title="手动添加学生"
              aria-label="手动添加学生"
            >
              <Plus className="w-4 h-4" />
            </button>
            {viewTab === 'today' && (
              <span className="text-xs text-gray-500 ml-1">
                <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{progressedTaskCount}</span>
                /{progressTaskTotal}
              </span>
            )}
          </div>
        </header>

        {/* Backlog alert */}
        {backlogBanner}

        {viewTab === 'today' ? (
          <>
            {/* Filter panel */}
            <FilterPanel
              students={students}
              schoolGroups={schoolGroups}
              selectedSchool={selectedSchool}
              onSchoolChange={setSelectedSchool}
              selectedStage={selectedStage}
              onStageChange={setSelectedStage}
              selectedIntent={selectedIntent}
              onIntentChange={setSelectedIntent}
              scoreRange={scoreRange}
              onScoreRangeChange={setScoreRange}
              selectedStatus={selectedStatus}
              onStatusChange={setSelectedStatus}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              totalCount={filteredStudents.length}
              queueTotal={taskProgress?.pending}
              intentCounts={intentCounts}
            />

            {/* Stats progress */}
            <StatsBar stats={filteredStats} progressStats={taskProgress} variant="full" />

            {/* Student table */}
            <StudentTable
              students={sortedStudents}
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
              sortConfig={sortConfig}
              onSort={handleSort}
              onDial={handleDial}
              onQuickStatus={updateStatus}
              onUpdateStage={updateStage}
              onAddNote={addNote}
              onScoreChange={updateScore}
              lockedStudentId={lockedStudentId}
              noteText={noteText}
              onNoteTextChange={setNoteText}
            />

            {/* Pagination */}
            <PaginationBar
              currentIdx={currentIdx}
              total={filteredStudents.length}
              onPrev={() => currentIdx > 0 && setCurrentIdx(currentIdx - 1)}
              onNext={() => currentIdx < filteredStudents.length - 1 && setCurrentIdx(currentIdx + 1)}
            />
          </>
        ) : viewTab === 'handled' ? (
          <HandledView
            onOpenDetail={async (id) => { await loadDetail(id); setShowDetail(true); }}
          />
        ) : (
          <FollowingView
            followingData={followingData}
            loading={followingLoading}
            onRefresh={fetchFollowing}
            onOpenDetail={async (id) => { await loadDetail(id); setShowDetail(true); }}
          />
        )}

        <StudentDetailDrawer
          open={showDetail}
          student={detailStudent}
          loading={detailLoading}
          error={detailError}
          calls={detailCalls}
          notes={detailNotes}
          followUps={detailFollowUps}
          visits={detailVisits}
          intentTimeline={detailIntentTimeline}
          admissionsTimeline={detailAdmissionsTimeline}
          onClose={() => setShowDetail(false)}
          onRetry={() => detailStudent && loadDetail(detailStudent.id)}
          onUpdateField={updateDetailField}
          onDial={handleDial}
          onStatusUpdate={updateStatus}
          statusLocked={lockedStudentId === detailStudent?.id}
          onStageSynced={onAdmissionsStageSynced}
          onRefreshDetail={() => detailStudent && loadDetail(detailStudent.id)}
        />

        <div
          aria-live="polite"
          className={`pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-950 px-4 py-2 text-xs font-medium text-white shadow-lg transition-all dark:bg-white dark:text-gray-900 ${
            actionMsg ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          {actionMsg}
        </div>
      </div>
    </div>
  );
}
