import useLeadOutcomeCatalog from '../../../hooks/useLeadOutcomeCatalog';
import { quickStatusForOutcome } from '../agentWorkUtils';
import { statusLabel } from '../../../labels';

export default function QuickStatusButtons({ onStatus }) {
  const { results } = useLeadOutcomeCatalog();
  const quickStatuses = results.map(quickStatusForOutcome);
  return (
    <div className="flex flex-wrap gap-2">
      {quickStatuses.map((s) => (
        <button
          key={s.outcome.code}
          onClick={() => onStatus(s.outcome)}
          className={`flex min-h-[44px] items-center gap-1 px-3 py-2 text-white rounded-lg text-xs leading-4 whitespace-normal font-medium ${s.color}`}
        >
          <s.icon className="w-3.5 h-3.5" />
          {statusLabel(s.status)}
        </button>
      ))}
    </div>
  );
}
