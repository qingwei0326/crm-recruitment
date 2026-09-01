import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentTable from '../StudentTable';

const student = {
  id: 42,
  name: '林宇涛',
  school_name: '漳州一中',
  region: '芗城区',
  stage: '初步接触',
  intent_level: 'A',
  status: '未联系',
  guardian_phone: '13800138000',
};

function renderTable() {
  return render(
    <StudentTable
      students={[student]}
      expandedId={null}
      onToggleExpand={vi.fn()}
      sortConfig={{ key: 'name', direction: 'asc' }}
      onSort={vi.fn()}
      onDial={vi.fn()}
      onQuickStatus={vi.fn()}
      onUpdateStage={vi.fn()}
      onAddNote={vi.fn()}
      onScoreChange={vi.fn()}
      lockedStudentId={null}
      noteText=""
      onNoteTextChange={vi.fn()}
    />
  );
}

describe('StudentTable agent workflow controls', () => {
  it('keeps writing notes available and removes AI analysis controls', () => {
    renderTable();

    expect(screen.getByRole('button', { name: '给 林宇涛 写备注' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /分析/ })).not.toBeInTheDocument();
    expect(screen.queryByText('AI分析')).not.toBeInTheDocument();
  });
});
