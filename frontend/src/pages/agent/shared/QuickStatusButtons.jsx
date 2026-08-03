import useLeadOutcomeCatalog from '../../../hooks/useLeadOutcomeCatalog';
import { quickStatusForOutcome } from '../agentWorkUtils';
import { statusLabel } from '../../../labels';

export default function QuickStatusButtons({ onStatus, disabled = false }) {
  const { results } = useLeadOutcomeCatalog();
  const quickStatuses = results.map(quickStatusForOutcome);
  return (
    <div className="flex flex-wrap gap-2">
      {quickStatuses.map((s) => (
        <button
          key={s.outcome.code}
          onClick={() => onStatus(s.outcome)}
          disabled={disabled}
          className={`flex min-h-[40px] items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium leading-4 text-white transition disabled:cursor-not-allowed disabled:opacity-35 ${s.color}`}
        >
          <s.icon className="w-3.5 h-3.5" />
          {statusLabel(s.status)}
        </button>
      ))}
    </div>
  );
}
