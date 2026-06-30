import { useMemo } from 'react';
import { Phone, HelpCircle, Plus } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import AgentSidebar from './desktop/AgentSidebar';
import FilterPanel from './desktop/FilterPanel';
import StatsBar from './desktop/StatsBar';
import StudentTable from './desktop/StudentTable';
import PaginationBar from './desktop/PaginationBar';
import FollowingView from './desktop/FollowingView';
import HandledView from './desktop/HandledView';
import StudentDetailDrawer from './desktop/StudentDetailDrawer';
import AiPanel from './AiPanel';

export default function AgentWorkDesktop({
  user, dark, toggleTheme, logout,
  viewTab, setViewTab,
  students, filteredStudents, filteredStats, schoolGroups,
  currentIdx, setCurrentIdx, current,
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
  noteText, setNoteText,
  dialCheckByStudent, lockedStudentId,
  handleDial, updateStatus, updateStage, addNote, openAiPanel, updateScore,
  detailLoading, detailError, detailCalls, detailNotes, detailFollowUps, detailVisits,
  detailIntentTimeline, hasAnalysis, updateDetailField,
  showDetail, detailStudent, showAi, activeStudent,
  setShowDetail, setShowAi, loadDetail,
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
          case 'stage': return ['初次联系', '有意向', '已送资料', '预约参观', '已来访', '已报名'].indexOf(s.stage);
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

  const handleGoToStudent = (idx) => {
    setCurrentIdx(idx);
    setViewTab('today');
  };

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">
      {modals}
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col">
        <div className="flex items-center gap-3 px-4 h-14 border-b dark:border-gray-700">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
            <Phone className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">话务工作台</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{user?.name}</div>
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
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {viewTab === 'today' ? '待拨打' : viewTab === 'handled' ? '待处理' : '跟进中'}
          </h2>
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
                {filteredStats.done}/{filteredStats.total}
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
            />

            {/* Stats progress */}
            <StatsBar stats={filteredStats} variant="full" />

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
              onOpenAi={openAiPanel}
              onScoreChange={updateScore}
              dialCheckByStudent={dialCheckByStudent}
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

        {/* AI panel overlay (right side, hidden on mobile) */}
        {showAi && activeStudent && (
          <div className="hidden lg:flex fixed right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-800 border-l dark:border-gray-700 flex-col z-30 shadow-xl">
            <AiPanel
              activeStudent={activeStudent}
              onClose={() => setShowAi(false)}
              onStatusUpdate={updateStatus}
            />
          </div>
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
          hasAnalysis={hasAnalysis}
          onClose={() => setShowDetail(false)}
          onRetry={() => detailStudent && loadDetail(detailStudent.id)}
          onUpdateField={updateDetailField}
          onDial={handleDial}
        />
      </div>
    </div>
  );
}
