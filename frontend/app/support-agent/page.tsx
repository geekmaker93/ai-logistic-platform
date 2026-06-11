"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptSupportSession,
  closeChatSession,
  createSupportChannel,
  fetchChatSession,
  fetchPendingSupportSessions,
  fetchSupportMessages,
  getSupportAgentActor,
  getSupportSupabaseClient,
  sendSupportMessage,
  type ChatSession,
  type SupportActor,
  type SupportMessage,
} from "@/lib/support-chat";

// ─── tiny icon components ────────────────────────────────────────────────────

function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 3v-6A3 3 0 0 1 4 14V7z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ─── types ───────────────────────────────────────────────────────────────────

type AgentSession = { name: string; actor: SupportActor };

// ─── sign-in panel ───────────────────────────────────────────────────────────

function SignInPanel(props: Readonly<{ onSignIn: (name: string) => void }>) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter your agent name.");
      return;
    }
    props.onSignIn(trimmed);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <section className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-cyan-700/30 p-2.5 text-cyan-300">
            <ChatBubbleIcon />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Support Portal</p>
            <h1 className="text-lg font-semibold text-white">Agent Sign In</h1>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Agent name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Sarah Johnson"
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            autoFocus
          />
        </label>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <button
          type="button"
          onClick={submit}
          className="mt-5 w-full rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
        >
          Continue to Dashboard
        </button>
      </section>
    </div>
  );
}

// ─── session row in queue ─────────────────────────────────────────────────────

function QueueRow(props: Readonly<{
  session: ChatSession;
  accepting: boolean;
  onAccept: (id: string) => void;
}>) {
  const { session, accepting, onAccept } = props;
  const age = Math.round((Date.now() - new Date(session.created_at).getTime()) / 60000);

  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">Session {session.id.slice(0, 8).toUpperCase()}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Waiting {age < 1 ? "< 1 min" : `${age} min`} · {session.status}
        </p>
      </div>
      <button
        type="button"
        disabled={accepting}
        onClick={() => onAccept(session.id)}
        className="shrink-0 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-60"
      >
        {accepting ? "Accepting…" : "Accept"}
      </button>
    </li>
  );
}

// ─── active chat panel ────────────────────────────────────────────────────────

function ActiveChat(props: Readonly<{
  session: ChatSession;
  agent: SupportActor;
  onClose: () => void;
}>) {
  const { session, agent, onClose } = props;
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<ReturnType<typeof createSupportChannel> | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      const rows = await fetchSupportMessages(session.id);
      setMessages(rows);
    } catch {
      setError("Failed to load messages.");
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const channel = createSupportChannel(`agent-chat:${agent.key}:${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `session_id=eq.${session.id}` }, async () => {
        try {
          const rows = await fetchSupportMessages(session.id);
          setMessages(rows);
        } catch {
          // silently ignore realtime errors; poll is the fallback
        }
      })
      .subscribe();

    channelRef.current = channel;

    const poll = setInterval(() => void loadMessages(), 4000);

    return () => {
      clearInterval(poll);
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [session.id, agent.key, loadMessages]);

  async function send() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError("");
    try {
      await sendSupportMessage(agent, trimmed, session.id);
      setDraft("");
      await loadMessages();
    } catch {
      setError("Failed to send message.");
    }
  }

  async function closeSession() {
    setClosing(true);
    try {
      await closeChatSession(session.id);
      onClose();
    } catch {
      setError("Failed to close session.");
      setClosing(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-700 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Active Chat</p>
          <p className="mt-0.5 text-sm text-slate-400">Session {session.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadMessages()}
            className="rounded-lg border border-slate-600 p-2 text-slate-300 hover:bg-slate-700"
            title="Refresh messages"
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            disabled={closing}
            onClick={() => void closeSession()}
            className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
          >
            {closing ? "Closing…" : "Close Chat"}
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {loading && <p className="text-xs text-slate-500">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-xs text-slate-500">No messages yet. The client will appear here.</p>
        )}
        {messages.map((msg) => {
          const isAgent = msg.sender_type === "support";
          return (
            <article
              key={msg.id}
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${isAgent ? "ml-auto bg-cyan-700 text-white" : "bg-slate-700 text-slate-100"}`}
            >
              <p className="text-[11px] font-semibold opacity-70">{isAgent ? "You" : msg.sender_name}</p>
              <p className="whitespace-pre-wrap break-words">{msg.message}</p>
              <p className={`mt-1 text-[10px] ${isAgent ? "text-cyan-200" : "text-slate-400"}`}>
                {new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            </article>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && <p className="px-4 pb-2 text-xs text-rose-400">{error}</p>}

      <div className="border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Type your reply…"
            className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-500"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim()}
            className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main dashboard ───────────────────────────────────────────────────────────

function AgentDashboard(props: Readonly<{ agentSession: AgentSession; onSignOut: () => void }>) {
  const { agentSession, onSignOut } = props;
  const { actor } = agentSession;

  const [queue, setQueue] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState("");

  const loadQueue = useCallback(async () => {
    try {
      const rows = await fetchPendingSupportSessions();
      setQueue(rows);
      setQueueError("");
    } catch {
      setQueueError("Failed to load queue. Retrying…");
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    const interval = setInterval(() => void loadQueue(), 6000);

    // also subscribe to realtime inserts on support_sessions
    const supabase = getSupportSupabaseClient();
    const channel = supabase
      .channel("agent-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_sessions" }, () => void loadQueue())
      .subscribe();

    return () => {
      clearInterval(interval);
      channel.unsubscribe();
    };
  }, [loadQueue]);

  async function accept(sessionId: string) {
    setAccepting(sessionId);
    try {
      const updated = await acceptSupportSession(sessionId, actor);
      setActiveSession(updated);
      setQueue((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      setQueueError("Failed to accept session.");
    } finally {
      setAccepting(null);
    }
  }

  async function handleChatClosed() {
    setActiveSession(null);
    await loadQueue();
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">

        <header className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-cyan-700/30 p-2.5 text-cyan-300"><ChatBubbleIcon /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Support Agent Portal</p>
              <p className="text-base font-semibold text-white">{actor.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Sign Out
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">

          {/* queue */}
          <section className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">
                Pending Queue
                {queue.length > 0 && (
                  <span className="ml-2 rounded-full bg-cyan-700 px-2 py-0.5 text-xs font-bold text-white">
                    {queue.length}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => void loadQueue()}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800"
                title="Refresh queue"
              >
                <RefreshIcon />
              </button>
            </div>

            {loadingQueue && <p className="text-xs text-slate-500">Loading queue…</p>}
            {queueError && <p className="text-xs text-rose-400">{queueError}</p>}
            {!loadingQueue && queue.length === 0 && !queueError && (
              <p className="text-xs text-slate-500">No pending sessions. New requests will appear here automatically.</p>
            )}
            {queue.length > 0 && (
              <ul className="space-y-2">
                {queue.map((s) => (
                  <QueueRow
                    key={s.id}
                    session={s}
                    accepting={accepting === s.id}
                    onAccept={(id) => void accept(id)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* active chat */}
          <section className="min-h-[480px]">
            {activeSession ? (
              <ActiveChat
                session={activeSession}
                agent={actor}
                onClose={() => void handleChatClosed()}
              />
            ) : (
              <div className="flex h-full min-h-[480px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 text-center p-8">
                <span className="mb-3 rounded-2xl bg-slate-800 p-4 text-slate-500"><ChatBubbleIcon /></span>
                <p className="text-sm font-medium text-slate-400">No active chat</p>
                <p className="mt-1 text-xs text-slate-600">Accept a session from the queue to start replying.</p>
              </div>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}

// ─── page root ────────────────────────────────────────────────────────────────

export default function SupportAgentPage() {
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);

  function signIn(name: string) {
    const actor = getSupportAgentActor(name);
    if (!actor) return;
    setAgentSession({ name, actor });
    globalThis.sessionStorage?.setItem("support-agent-name", name);
  }

  function signOut() {
    setAgentSession(null);
    globalThis.sessionStorage?.removeItem("support-agent-name");
  }

  // restore session on mount (survives page refresh)
  useEffect(() => {
    const saved = globalThis.sessionStorage?.getItem("support-agent-name");
    if (saved) {
      signIn(saved);
    }
  }, []);

  if (!agentSession) {
    return <SignInPanel onSignIn={signIn} />;
  }

  return <AgentDashboard agentSession={agentSession} onSignOut={signOut} />;
}
