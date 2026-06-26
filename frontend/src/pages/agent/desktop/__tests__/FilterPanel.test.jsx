import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterPanel from '../FilterPanel';

const defaultProps = {
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
  scoreRange: { min: '', max: '' },
  onScoreRangeChange: vi.fn(),
  totalCount: 5,
};

describe('FilterPanel', () => {
  it('renders current filter controls and total count', () => {
    render(<FilterPanel {...defaultProps} />);

    expect(screen.getByRole('button', { name: /条件筛选/ })).toBeInTheDocument();
    expect(screen.getByText('数据总数')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('学校')).toBeInTheDocument();
    expect(screen.getByText('阶段')).toBeInTheDocument();
    expect(screen.getByText('意向')).toBeInTheDocument();
    expect(screen.getByText('分数范围')).toBeInTheDocument();
  });

  it('changes school, stage, and intent filters from selects', () => {
    const onSchoolChange = vi.fn();
    const onStageChange = vi.fn();
    const onIntentChange = vi.fn();
    render(
      <FilterPanel
        {...defaultProps}
        onSchoolChange={onSchoolChange}
        onStageChange={onStageChange}
        onIntentChange={onIntentChange}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '学校A' } });
    fireEvent.change(selects[1], { target: { value: '有意向' } });
    fireEvent.change(selects[2], { target: { value: 'A' } });

    expect(onSchoolChange).toHaveBeenCalledWith('学校A');
    expect(onStageChange).toHaveBeenCalledWith('有意向');
    expect(onIntentChange).toHaveBeenCalledWith('A');
  });

  it('updates score range inputs', () => {
    const onScoreRangeChange = vi.fn();
    render(<FilterPanel {...defaultProps} onScoreRangeChange={onScoreRangeChange} />);

    const minInput = screen.getByPlaceholderText('最低');
    const maxInput = screen.getByPlaceholderText('最高');
    fireEvent.change(minInput, { target: { value: '300' } });
    fireEvent.change(maxInput, { target: { value: '500' } });

    expect(onScoreRangeChange).toHaveBeenCalledWith({ min: '300', max: '' });
    expect(onScoreRangeChange).toHaveBeenCalledWith({ min: '', max: '500' });
  });

  it('clears all active filters', () => {
    const onSchoolChange = vi.fn();
    const onStageChange = vi.fn();
    const onIntentChange = vi.fn();
    const onScoreRangeChange = vi.fn();
    render(
      <FilterPanel
        {...defaultProps}
        selectedSchool="学校A"
        selectedStage="有意向"
        selectedIntent="A"
        scoreRange={{ min: '300', max: '500' }}
        onSchoolChange={onSchoolChange}
        onStageChange={onStageChange}
        onIntentChange={onIntentChange}
        onScoreRangeChange={onScoreRangeChange}
      />,
    );

    expect(screen.getByText('已筛选')).toBeInTheDocument();
    fireEvent.click(screen.getByText('清除所有筛选'));

    expect(onSchoolChange).toHaveBeenCalledWith(null);
    expect(onStageChange).toHaveBeenCalledWith(null);
    expect(onIntentChange).toHaveBeenCalledWith(null);
    expect(onScoreRangeChange).toHaveBeenCalledWith({ min: '', max: '' });
  });

  it('collapses and expands the filter body', () => {
    render(<FilterPanel {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /条件筛选/ }));
    expect(screen.queryByText('学校')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /条件筛选/ }));
    expect(screen.getByText('学校')).toBeInTheDocument();
  });
});
