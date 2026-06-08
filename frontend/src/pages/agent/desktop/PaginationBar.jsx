import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PaginationBar({ currentIdx, total, onPrev, onNext }) {
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
      <button
        onClick={onPrev}
        disabled={currentIdx <= 0}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 disabled:opacity-30 text-gray-600 dark:text-gray-300"
      >
        <ChevronLeft className="w-4 h-4" /> 上一条
      </button>
      <span className="text-xs text-gray-500">
        {currentIdx + 1} / {total}
      </span>
      <button
        onClick={onNext}
        disabled={currentIdx >= total - 1}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 disabled:opacity-30 text-gray-600 dark:text-gray-300"
      >
        下一条 <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
