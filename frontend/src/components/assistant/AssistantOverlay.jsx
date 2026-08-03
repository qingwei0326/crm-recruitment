import { useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAssistant } from '../../context/AssistantContext';
import useIsMobile from '../../hooks/useIsMobile';
import AssistantPanel from './AssistantPanel';

export default function AssistantOverlay() {
  const assistant = useAssistant();
  const isMobile = useIsMobile();
  const location = useLocation();
  const resizing = useRef(false);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && assistant.open) assistant.setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [assistant]);

  useEffect(() => {
    const move = (event) => {
      if (!resizing.current) return;
      assistant.setWidth(window.innerWidth - event.clientX);
    };
    const stop = () => { resizing.current = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
  }, [assistant]);

  useEffect(() => {
    if (!isMobile || !assistant.open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [assistant.open, isMobile]);

  if (!assistant.active || location.pathname === '/admin/assistant') return null;

  if (!assistant.open) {
    return (
      <button
        type="button"
        title="AI 助手"
        aria-label="打开 AI 助手"
        onClick={assistant.openAssistant}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-[90] flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xl transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 md:bottom-5 md:right-5"
      >
        <Bot className="h-5 w-5" />
      </button>
    );
  }

  const desktopWidth = assistant.maximized ? 'calc(100vw - 15rem)' : `${assistant.width}px`;
  return (
    <>
      {isMobile && <div className="fixed inset-0 z-[109] bg-black/35" onClick={() => assistant.setOpen(false)} />}
      <section
        aria-label="AI 助手"
        style={isMobile ? undefined : { width: desktopWidth }}
        className="fixed inset-x-0 top-0 z-[110] h-[100dvh] w-full border-l bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:inset-y-0 md:left-auto md:h-auto md:w-auto"
      >
        {!isMobile && !assistant.maximized && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整助手宽度"
            onMouseDown={(event) => {
              event.preventDefault();
              resizing.current = true;
            }}
            className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-blue-500"
          />
        )}
        <AssistantPanel onClose={() => assistant.setOpen(false)} />
      </section>
    </>
  );
}
