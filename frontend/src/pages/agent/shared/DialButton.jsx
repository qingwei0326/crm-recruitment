import { Phone } from 'lucide-react';

export default function DialButton({ contact, dialCheck, onDial }) {
  const cnt = dialCheck?.count ?? 0;
  const warn = cnt >= 3;

  return (
    <button
      onClick={() => onDial(contact.key)}
      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm text-white ${
        warn
          ? 'bg-red-600 hover:bg-red-700 ring-2 ring-red-300 dark:ring-red-700'
          : 'bg-green-600 hover:bg-green-700'
      }`}
      title={contact.phone}
    >
      <Phone className="w-4 h-4" /> {contact.name !== contact.label ? `${contact.label} ${contact.name}` : contact.label}
      {dialCheck && (
        <span className="text-[10px] opacity-90">(24h 已 {cnt} 次)</span>
      )}
    </button>
  );
}
