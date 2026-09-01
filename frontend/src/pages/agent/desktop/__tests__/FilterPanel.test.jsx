import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FilterPanel from '../FilterPanel';

const defaultProps = {
  students: [
    { id: 1, school_name: '学校A' },
    { id: 2, school_name: '学校A' },
    { id: 3, school_name: '学校A' },
    { id: 4, school_name: '学校B' },
    { id: 5, school_name: '学校B' },
  ],
  schoolGroups: [
    { name: '学校A', count: 3 },
    { name: '学校B', count: 2 },
  ],
  selectedSchool: null,
  onSchoolChange: vi.fn(),
  selectedStage: null,
  onStageChange: vi.fn(),
  selectedIntent: null,
  onIntentChange: vi.fn(),
  selectedStatus: null,
  onStatusChange: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  scoreRange: { min: '', max: '' },
  onScoreRangeChange: vi.fn(),
  totalCount: 5,
  intentCounts: { A: 2, B: 1, C: 1, '无': 1 },
};

describe('FilterPanel', () => {
  it('keeps search, school shortcuts, and result count visible', () => {
    render(<FilterPanel {...defaultProps} />);

    expect(screen.getByRole('searchbox', { name: '搜索学生' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '筛选' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /全部学校 5/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /学校A3/ })).toBeInTheDocument();
    expect(screen.getByText('当前结果')).toBeInTheDocument();
    expect(screen.getAllByText('5')).toHaveLength(3);
  });

  it('changes search and school filters from the primary controls', () => {
    const onSearchChange = vi.fn();
    const onSchoolChange = vi.fn();
    render(
      <FilterPanel
        {...defaultProps}
        onSearchChange={onSearchChange}
        onSchoolChange={onSchoolChange}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索学生' }), {
      target: { value: '林同学' },
    });
    fireEvent.click(screen.getByRole('button', { name: /学校A3/ }));

    expect(onSearchChange).toHaveBeenCalledWith('林同学');
    expect(onSchoolChange).toHaveBeenCalledWith('学校A');
  });

  it('opens the A-level priority queue from the primary controls', () => {
    const onIntentChange = vi.fn();
    render(<FilterPanel {...defaultProps} onIntentChange={onIntentChange} />);

    const priorityButton = screen.getByRole('button', { name: /A级优先 2/ });
    fireEvent.click(priorityButton);

    expect(onIntentChange).toHaveBeenCalledWith('A');
    expect(priorityButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes stage, intent, and status filters from the advanced panel', () => {
    const onStageChange = vi.fn();
    const onIntentChange = vi.fn();
    const onStatusChange = vi.fn();
    render(
      <FilterPanel
        {...defaultProps}
        onStageChange={onStageChange}
        onIntentChange={onIntentChange}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '按阶段筛选' }), { target: { value: '有意向' } });
    fireEvent.change(screen.getByRole('combobox', { name: '按意向筛选' }), { target: { value: 'A' } });
    fireEvent.change(screen.getByRole('combobox', { name: '按状态筛选' }), { target: { value: '待回访' } });

    expect(onStageChange).toHaveBeenCalledWith('有意向');
    expect(onIntentChange).toHaveBeenCalledWith('A');
    expect(onStatusChange).toHaveBeenCalledWith('待回访');
  });

  it('updates score range inputs', () => {
    const onScoreRangeChange = vi.fn();
    render(<FilterPanel {...defaultProps} onScoreRangeChange={onScoreRangeChange} />);

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByPlaceholderText('最低'), { target: { value: '300' } });
    fireEvent.change(screen.getByPlaceholderText('最高'), { target: { value: '500' } });

    expect(onScoreRangeChange).toHaveBeenCalledWith({ min: '300', max: '' });
    expect(onScoreRangeChange).toHaveBeenCalledWith({ min: '', max: '500' });
  });

  it('clears every active filter', () => {
    const handlers = {
      onSearchChange: vi.fn(),
      onSchoolChange: vi.fn(),
      onStageChange: vi.fn(),
      onIntentChange: vi.fn(),
      onStatusChange: vi.fn(),
      onScoreRangeChange: vi.fn(),
    };
    render(
      <FilterPanel
        {...defaultProps}
        {...handlers}
        searchQuery="林"
        selectedSchool="学校A"
        selectedStage="有意向"
        selectedIntent="A"
        selectedStatus="待回访"
        scoreRange={{ min: '300', max: '500' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(handlers.onSearchChange).toHaveBeenCalledWith('');
    expect(handlers.onSchoolChange).toHaveBeenCalledWith(null);
    expect(handlers.onStageChange).toHaveBeenCalledWith(null);
    expect(handlers.onIntentChange).toHaveBeenCalledWith(null);
    expect(handlers.onStatusChange).toHaveBeenCalledWith(null);
    expect(handlers.onScoreRangeChange).toHaveBeenCalledWith({ min: '', max: '' });
  });

  it('expands and collapses the advanced filter body', () => {
    render(<FilterPanel {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: '筛选' });

    expect(screen.queryByRole('combobox', { name: '按阶段筛选' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('combobox', { name: '按阶段筛选' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(screen.queryByRole('combobox', { name: '按阶段筛选' })).not.toBeInTheDocument();
  });
});
