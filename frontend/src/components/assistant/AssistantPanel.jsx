import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAssistant } from '../../context/AssistantContext';

function InlineMarkdown({ text }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-black/10 px-1 py-0.5 text-[0.9em] dark:bg-white/10">{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function MessageContent({ content }) {
  return String(content || '').split('\n').map((line, index) => {
    const bullet = line.match(/^(\s*)-\s+(.*)$/);
    if (bullet) {
      return (
        <div key={index} className="flex gap-2" style={{ paddingLeft: `${Math.min(bullet[1].length, 4) * 0.75}rem` }}>
          <span aria-hidden="true">•</span>
          <span className="min-w-0"><InlineMarkdown text={bullet[2]} /></span>
        </div>
      );
    }
    return <div key={index} className={line ? '' : 'h-3'}><InlineMarkdown text={line} /></div>;
  });
}

function timelineItems(detail) {
  const messages = (detail?.messages || []).map((item) => ({ ...item, type: 'message' }));
  const calls = (detail?.tool_calls || []).map((item) => ({ ...item, type: 'tool' }));
  return [...messages, ...calls].sort((a, b) => {
    const dateOrder = String(a.created_at).localeCompare(String(b.created_at));
    if (dateOrder) return dateOrder;
    if (a.type !== b.type) return a.type === 'message' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

function PreviewItem({ item }) {
  const title = item.name || item.new_agent_name || item.reason || `记录 ${item.id || ''}`;
  const details = [
    item.school_name,
    item.old_status && item.new_status ? `${item.old_status} → ${item.new_status}` : '',
    item.reason && item.name ? `原因：${item.reason}` : '',
    item.old_agent_id !== undefined ? `原归属：${item.old_agent_id ?? '未分配'}` : '',
    item.will_delete ? '将永久删除' : '',
  ].filter(Boolean);
  return (
    <div className="min-w-0 border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-700">
      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{title}</div>
      {details.length > 0 && (
        <div className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">
          {details.join(' · ')}
        </div>
      )}
    </div>
  );
}

function DestructiveConfirm({ call, busy, onCancel, onConfirm }) {
  const [phrase, setPhrase] = useState('');
  const matches = phrase === call.confirmation_phrase;
  return (
    <div className="fixed inset-0 z-[170] flex items-end justify-center overflow-y-auto bg-black/50 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-destructive-title"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-t-xl border border-red-200 bg-white shadow-2xl dark:border-red-900 dark:bg-gray-800 sm:rounded-lg"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3 dark:border-gray-700">
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
          <h2 id="assistant-destructive-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {call.tool_label}
          </h2>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">{call.preview?.summary}</p>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300" htmlFor="assistant-confirm-phrase">
            {call.confirmation_phrase}
          </label>
          <input
            id="assistant-confirm-phrase"
            autoFocus
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm dark:border-gray-600 dark:text-gray-200"
          >
            <Ban className="h-4 w-4" />
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(phrase)}
            disabled={!matches || busy}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolCallCard({ call, busy, oneTimeResult, onApprove, onReject }) {
  const [confirming, setConfirming] = useState(false);
  const pending = call.status === 'pending_confirmation';
  const readOnly = call.risk_level === 'read';
  const destructive = call.risk_level === 'destructive';

  if (readOnly && call.status === 'executed') {
    return (
      <div className="flex items-center gap-2 px-1 py-1 text-xs text-gray-500 dark:text-gray-400">
        <Check className="h-3.5 w-3.5 text-green-600" />
        <span className="truncate">{call.tool_label}</span>
      </div>
    );
  }

  const tone = destructive
    ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20'
    : 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20';

  return (
    <>
      <div className={`rounded-lg border p-3 ${tone}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {destructive ? <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" /> : <Bot className="h-4 w-4 shrink-0 text-amber-600" />}
              <span className="truncate">{call.tool_label}</span>
            </div>
            <div className="mt-1 break-words text-xs text-gray-600 dark:text-gray-300">
              {call.preview?.summary || call.error_message || (call.status === 'executed' ? '执行完成' : '等待处理')}
            </div>
          </div>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {pending ? '待确认' : call.status === 'executed' ? '已完成' : call.status}
          </span>
        </div>

        {pending && (call.preview?.items || []).length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-white/80 px-2 dark:bg-gray-800/70">
            {call.preview.items.slice(0, 8).map((item, index) => (
              <PreviewItem key={item.id || index} item={item} />
            ))}
          </div>
        )}

        {oneTimeResult?.new_password && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-white px-3 py-2 dark:border-green-900 dark:bg-gray-800">
            <code className="min-w-0 break-all text-sm font-semibold text-green-700 dark:text-green-400">
              {oneTimeResult.new_password}
            </code>
            <button
              type="button"
              title="复制一次性密码"
              aria-label="复制一次性密码"
              onClick={() => navigator.clipboard?.writeText(oneTimeResult.new_password)}
              className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        )}

        {pending && (
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onReject(call)}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium dark:border-gray-600 dark:text-gray-200"
            >
              <Ban className="h-3.5 w-3.5" />
              取消
            </button>
            <button
              type="button"
              onClick={() => destructive ? setConfirming(true) : onApprove(call, '')}
              disabled={busy}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-white disabled:opacity-50 ${destructive ? 'bg-red-600' : 'bg-amber-600'}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              确认执行
            </button>
          </div>
        )}
      </div>
      {confirming && (
        <DestructiveConfirm
          call={call}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async (phrase) => {
            await onApprove(call, phrase);
            setConfirming(false);
          }}
        />
      )}
    </>
  );
}

export default function AssistantPanel({ fullPage = false, onClose }) {
  const assistant = useAssistant();
  const [draft, setDraft] = useState('');
  const scrollerRef = useRef(null);
  const timeline = useMemo(() => timelineItems(assistant.detail), [assistant.detail]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [timeline.length, assistant.sending]);

  const submit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      await assistant.sendMessage(text);
    } catch {
      setDraft(text);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
      <header className={`relative z-20 flex min-h-14 shrink-0 items-center gap-2 border-b px-3 dark:border-gray-700 ${fullPage ? '' : 'pt-[env(safe-area-inset-top)]'}`}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Bot className="h-4 w-4" />
        </div>
        <div className="relative min-w-0 flex-1">
          <select
            aria-label="助手会话"
            value={assistant.activeSessionId}
            onChange={(event) => assistant.selectSession(event.target.value)}
            className="h-9 w-full appearance-none truncate rounded-lg border bg-white pl-3 pr-8 text-sm font-medium text-gray-800 outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {assistant.sessions.length === 0 && <option value="">新对话</option>}
            {assistant.sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.title}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-gray-400" />
        </div>
        <button
          type="button"
          title="新建对话"
          aria-label="新建对话"
          onClick={() => assistant.createSession()}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" />
        </button>
        {!fullPage && (
          <button
            type="button"
            title={assistant.maximized ? '恢复宽度' : '最大化'}
            aria-label={assistant.maximized ? '恢复助手宽度' : '最大化助手'}
            onClick={() => assistant.setMaximized((value) => !value)}
            className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 md:block"
          >
            {assistant.maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            title="收起助手"
            aria-label="收起助手"
            onClick={onClose}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      <div ref={scrollerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {assistant.loading && timeline.length === 0 && (
          <div className="flex h-full items-center justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!assistant.loading && timeline.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
            <Bot className="h-9 w-9" />
            <span className="text-sm">新对话</span>
          </div>
        )}
        {timeline.map((item) => item.type === 'message' ? (
          <div key={`message-${item.id}`} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-6 ${item.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'}`}>
              <MessageContent content={item.content} />
            </div>
          </div>
        ) : (
          <ToolCallCard
            key={`tool-${item.id}`}
            call={item}
            busy={assistant.sending}
            oneTimeResult={assistant.oneTimeResults[item.id]}
            onApprove={assistant.approveToolCall}
            onReject={assistant.rejectToolCall}
          />
        ))}
      </div>

      {assistant.error && (
        <div className="shrink-0 border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {assistant.error}
        </div>
      )}

      <form onSubmit={submit} className={`shrink-0 border-t px-3 pt-3 dark:border-gray-700 ${fullPage ? 'pb-3' : 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]'}`}>
        <div className="flex items-end gap-2 rounded-lg border bg-white p-2 focus-within:ring-2 focus-within:ring-blue-500 dark:border-gray-700 dark:bg-gray-800">
          <textarea
            aria-label="给 AI 助手的消息"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="输入要查询或执行的操作"
            className="max-h-32 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-gray-900 outline-none dark:text-gray-100"
          />
          <button
            type="submit"
            title="发送"
            aria-label="发送消息"
            disabled={!draft.trim() || assistant.sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white disabled:opacity-50"
          >
            {assistant.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
