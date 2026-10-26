import { COMMON_PROGRAMS, toggleProgram } from './programs';

const fieldCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';

// A major field the agent can fill by tapping the common majors or by typing.
export default function ProgramPicker({ label, value, onChange, placeholder = '点下面选，也可以直接写' }) {
  const selected = value.split(/[、,，\s]+/).filter(Boolean);
  return (
    <div className="space-y-1">
      <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block">
        <span>{label}</span>
        <input
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={fieldCls}
          placeholder={placeholder}
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {COMMON_PROGRAMS.map((program) => {
          const isSelected = selected.includes(program);
          return (
            <button
              key={program}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(toggleProgram(value, program))}
              className={`min-h-[32px] rounded-full border px-2.5 text-xs ${
                isSelected
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'
              }`}
            >
              {program}
            </button>
          );
        })}
      </div>
    </div>
  );
}
