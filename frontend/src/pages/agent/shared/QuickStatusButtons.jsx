import { QUICK_STATUSES } from '../agentWorkUtils';
import { statusLabel } from '../../../labels';

export default function QuickStatusButtons({ onStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_STATUSES.map((s) => (
        <button
          key={s.status}
          onClick={() => onStatus(s.status)}
          className={`flex items-center gap-1 px-3 py-2 text-white rounded-lg text-xs font-medium ${s.color}`}
        >
          <s.icon className="w-3.5 h-3.5" />
          {statusLabel(s.status)}
        </button>
      ))}
    </div>
  );
}
