import { Phone } from 'lucide-react';

export default function DialButton({ contact, onDial }) {
  return (
    <button
      onClick={() => onDial(contact.key)}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2.5 text-sm text-white hover:bg-green-700"
      title={contact.phone}
    >
      <Phone className="w-4 h-4" /> {contact.name !== contact.label ? `${contact.label} ${contact.name}` : contact.label}
    </button>
  );
}
