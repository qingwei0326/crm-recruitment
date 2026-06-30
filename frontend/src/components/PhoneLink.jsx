import { Phone } from 'lucide-react';

export default function PhoneLink({
  value,
  label = '拨打电话',
  onDial,
  disabled = false,
  className = '',
}) {
  const phone = String(value || '').trim();
  if (!phone) {
    return <span className="text-gray-400 dark:text-gray-500 italic">未填</span>;
  }

  if (!onDial) {
    return <span className={className}>{phone}</span>;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDial();
      }}
      className={`inline-flex items-center gap-1 font-mono text-green-600 dark:text-green-400 underline decoration-green-400/40 underline-offset-2 hover:text-green-700 dark:hover:text-green-300 disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
      title={`${label}: ${phone}`}
      aria-label={`${label}: ${phone}`}
    >
      <Phone className="w-3.5 h-3.5" />
      <span>{phone}</span>
    </button>
  );
}
