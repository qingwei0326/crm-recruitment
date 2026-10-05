export const adminPageMainClass =
  'flex h-screen min-w-0 flex-1 flex-col overflow-y-auto bg-surface-page dark:bg-gray-950 scroll-thin';

export function AdminPageContainer({ children, className = '' }) {
  return (
    <div className={`mx-auto w-full max-w-[1500px] space-y-4 p-4 pb-16 lg:space-y-5 lg:p-6 lg:pb-16 ${className}`}>
      {children}
    </div>
  );
}

export function AdminSurface({ children, className = '', as: Component = 'section' }) {
  return (
    <Component
      className={`rounded-xl border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark ${className}`}
    >
      {children}
    </Component>
  );
}

export function AdminPageIntro({ title, description, meta, children, className = '' }) {
  return (
    <AdminSurface className={`p-4 lg:p-5 ${className}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:mr-auto">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-600" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-950 dark:text-slate-100">{title}</h2>
          </div>
          {description && (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          )}
        </div>
        {meta && <div className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{meta}</div>}
      </div>
      {children}
    </AdminSurface>
  );
}

export function AdminSectionHeading({ title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-bold text-slate-950 dark:text-slate-100">{title}</h2>
        {description && <p className="mt-0.5 text-2xs text-slate-400 dark:text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
