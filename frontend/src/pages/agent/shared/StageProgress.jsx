import { STAGES, stageLabel } from '../../../labels';

export default function StageProgress({ currentStage, onStageClick, compact = false }) {
  const idx = STAGES.indexOf(currentStage);

  if (compact) {
    // 6 dots for table row
    return (
      <div className="flex items-center gap-0.5">
        {STAGES.map((s, i) => (
          <button
            key={s}
            onClick={(e) => { e.stopPropagation(); onStageClick?.(s); }}
            className={`w-2 h-2 rounded-full transition-all ${
              i <= idx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
            } ${s === currentStage ? 'ring-1 ring-blue-300' : ''}`}
            title={stageLabel(s)}
          />
        ))}
      </div>
    );
  }

  // Full progress bar for expanded row
  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        {STAGES.map((s, i) => (
          <button
            key={s}
            onClick={() => onStageClick?.(s)}
            className={`flex-1 h-2 rounded-full transition-all ${
              i <= idx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
            } ${s === currentStage ? 'ring-2 ring-blue-300' : ''}`}
            title={stageLabel(s)}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        {STAGES.map((s) => (
          <span key={s} className={s === currentStage ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}>
            {stageLabel(s)}
          </span>
        ))}
      </div>
    </div>
  );
}
