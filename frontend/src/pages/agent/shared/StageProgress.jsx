import { STAGES, stageLabel } from '../../../labels';

export default function StageProgress({ currentStage, onStageClick, compact = false }) {
  const currentIndex = Math.max(STAGES.indexOf(currentStage), 0);
  const progress = STAGES.length > 1 ? (currentIndex / (STAGES.length - 1)) * 100 : 0;
  const editableStages = STAGES.filter((stage) => stage !== '已报名');

  if (compact) {
    return (
      <div className="min-w-0 max-w-[210px]">
        <select
          value={currentStage || STAGES[0]}
          onChange={(event) => onStageClick?.(event.target.value)}
          className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          aria-label="设置跟进阶段"
        >
          {editableStages.map((stage) => (
            <option key={stage} value={stage}>{stageLabel(stage)}</option>
          ))}
        </select>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={currentStage || STAGES[0]}
        onChange={(event) => onStageClick?.(event.target.value)}
        className="h-9 min-w-[170px] rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        aria-label="设置跟进阶段"
      >
          {editableStages.map((stage) => (
          <option key={stage} value={stage}>{stageLabel(stage)}</option>
        ))}
      </select>
      <div className="min-w-0 flex-1">
        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-3xs text-gray-400 dark:text-gray-500">
          <span>{stageLabel(STAGES[0])}</span>
          <span className="font-medium text-blue-600 dark:text-blue-400">{currentIndex + 1}/{STAGES.length}</span>
          <span>{stageLabel(STAGES[STAGES.length - 1])}</span>
        </div>
      </div>
    </div>
  );
}
