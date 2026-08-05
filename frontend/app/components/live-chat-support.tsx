"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  closeChatSession,
  createSupportChannel,
  ensureCurrentChatSession,
  fetchChatSession,
  fetchSupportMessages,
  getSupportActor,
  sendSupportMessage,
  setStoredChatSessionId,
  type SupportMessage,
  type SupportThreadState,
} from "@/lib/support-chat";

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-0-0V7z" />
    </svg>
  );
}

type LiveChatSupportProps = Readonly<{
  initialOpen?: boolean;
  standalone?: boolean;
}>;

export default function LiveChatSupport(props: LiveChatSupportProps) {
  const { initialOpen = false, standalone = false } = props;
  const actor = useMemo(() => getSupportActor(), []);
  const actorKey = actor?.key || "anonymous";
  const [open, setOpen] = useState(initialOpen || standalone);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [sessionState, setSessionState] = useState<SupportThreadState | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<ReturnType<typeof createSupportChannel> | null>(null);
  const activeSessionId = sessionState?.id || null;

  async function startFreshSession(): Promise<SupportThreadState> {
    const created = await ensureCurrentChatSession(actor);
    setStoredChatSessionId(created.id);
    return created;
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      setMessages([]);
      setSessionState(null);

      if (!actor) {
        setError("Please sign in as shipper or carrier to use live support chat.");
        setLoading(false);
        return;
      }

      try {
        let nextSession = null as SupportThreadState | null;

        try {
          nextSession = await startFreshSession();
        } catch {
          nextSession = null;
        }

        if (!nextSession) {
          setError("Support chat is temporarily unavailable. Please refresh or try again shortly.");
          return;
        }

        const rows = await fetchSupportMessages(nextSession.id);
        if (!mounted) {
          return;
        }

        setSessionState(nextSession);
        setMessages(rows);
      } catch {
        if (mounted) {
          setError("Support chat is temporarily unavailable. Please refresh or try again shortly.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [open, actor]);

  useEffect(() => {
    if (!open || !activeSessionId) {
      return;
    }

    let mounted = true;

    const pollTimer = setInterval(() => {
      void (async () => {
        try {
          const state = await fetchChatSession(activeSessionId);
          const rows = await fetchSupportMessages(activeSessionId);
          if (!mounted) {
            return;
          }
          if (state) {
            setSessionState(state);
          }
          setMessages(rows);
        } catch {
          // Keep silent here; realtime/polling errors are handled elsewhere.
        }
      })();
    }, 3000);

    const channel = createSupportChannel(`live-support:${actorKey}:${activeSessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `session_id=eq.${activeSessionId}` }, async () => {
        try {
          const state = await fetchChatSession(activeSessionId);
          const rows = await fetchSupportMessages(activeSessionId);
          if (state) {
            setSessionState(state);
          }
          setMessages(rows);
          if (document.hidden && Notification.permission === "granted") {
            const latest = rows[rows.length - 1];
            if (latest && latest.sender_key !== actor?.key) {
              new Notification(`New support message from ${latest.sender_name}`, { body: latest.message.slice(0, 120) });
            }
          }
        } catch {
          setError("Chat sync failed. Please refresh.");
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          setError("Realtime connection interrupted. Using fallback sync.");
        }
      });

    channelRef.current = channel;

    return () => {
      mounted = false;
      clearInterval(pollTimer);
      setTypingUsers({});
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
      channelRef.current = null;
    };
  }, [open, actor, actorKey, activeSessionId]);

  async function onSend() {
    if (!actor) {
      setError("Please sign in as shipper or carrier to use live support chat.");
      return;
    }

    if (!activeSessionId) {
      setError("Chat session is not ready yet.");
      return;
    }

    if (sessionState?.status === "closed") {
      setError("This chat session has ended.");
      return;
    }

    try {
      setError("");
      await sendSupportMessage(actor, draft, activeSessionId);
      const rows = await fetchSupportMessages(activeSessionId);
      setMessages(rows);
      setDraft("");
      channelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: { senderKey: actor.key, senderName: actor.name, typing: false },
      });
    } catch {
      setError("Failed to send message.");
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    if (!actor || !channelRef.current) {
      return;
    }

    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { senderKey: actor.key, senderName: actor.name, typing: value.trim().length > 0 },
    });
  }

  async function onEnableNotifications() {
    if (!("Notification" in globalThis)) {
      setError("Browser notifications are not supported on this device.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setError("");
      return;
    }

    setError("Notification permission was not granted.");
  }

  async function onCloseChat() {
    const currentSessionId = activeSessionId;
    if (currentSessionId) {
      try {
        await closeChatSession(currentSessionId);
      } catch {
        setError("Failed to end chat session.");
      }
    }

    setStoredChatSessionId(null);
    setSessionState((prev) => (prev ? { ...prev, status: "closed", closed_at: new Date().toISOString() } : prev));
    setMessages([]);
    setDraft("");
    setTypingUsers({});
    setOpen(false);
  }

  const typingNames = Object.values(typingUsers);
  const sessionIsActive = sessionState?.status === "active";
  const sessionIsPending = sessionState?.status === "pending";
  const isChatClosed = sessionState?.status === "closed";
  let messagePlaceholder = "Type your message";
  if (actor === null) {
    messagePlaceholder = "Sign in as shipper/carrier to chat";
  } else if (sessionIsPending) {
    messagePlaceholder = "Waiting for support to accept";
  } else if (isChatClosed) {
    messagePlaceholder = "Chat ended";
  }

  return (
    <div className={standalone ? "flex w-full justify-center" : "fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3"}>
      {open && (
        <section className={`${standalone ? "w-full max-w-2xl" : "w-[min(92vw,380px)]"} rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl`}>
          <header className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">24/7 Live Chat Support</p>
              <p className="text-xs text-slate-500">Session-based conversation</p>
            </div>
            {!standalone && (
              <button type="button" onClick={() => void onCloseChat()} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                Close
              </button>
            )}
          </header>

          <div className={`${standalone ? "h-[28rem]" : "h-72"} mt-2 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-2`}>
            {loading && <p className="text-xs text-slate-500">Loading messages...</p>}
            {!loading && messages.length === 0 && <p className="text-xs text-slate-500">No messages yet. Start the conversation.</p>}
            {!loading &&
              messages.map((msg) => {
                const mine = msg.sender_key === actor?.key;
                return (
                  <article key={msg.id} className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${mine ? "ml-auto bg-cyan-600 text-white" : "bg-white text-slate-800"}`}>
                    <p className="text-[11px] font-semibold opacity-80">{mine ? "You" : msg.sender_name}</p>
                    <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                    <p className={`mt-1 text-[10px] ${mine ? "text-cyan-100" : "text-slate-500"}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </article>
                );
              })}
            <div ref={endRef} />
          </div>

          {typingNames.length > 0 && <p className="mt-1 text-xs text-slate-500">{typingNames.join(", ")} typing...</p>}
          {sessionIsPending && <p className="mt-1 text-xs font-semibold text-cyan-700">Your request is pending. A support agent must accept it before chat begins.</p>}
          {isChatClosed && <p className="mt-1 text-xs font-semibold text-amber-700">Chat ended. Reopen later to start a new session.</p>}
          {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}

          <div className="mt-2 flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void onSend();
                }
              }}
              placeholder={messagePlaceholder}
              disabled={!sessionIsActive}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-600 disabled:bg-slate-100"
            />
            <button type="button" disabled={!sessionIsActive} onClick={() => void onSend()} className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50">
              Send
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => void onEnableNotifications()} className="text-[11px] font-medium text-cyan-700 hover:text-cyan-600">
              Enable notifications
            </button>
            {sessionState?.id && <span className="text-[10px] text-slate-400">Session {sessionState.id.slice(0, 8)}</span>}
          </div>
        </section>
      )}

      {!open && !standalone && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-cyan-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 transition hover:-translate-y-0.5 hover:bg-cyan-600"
        >
          <ChatIcon />
          Live Chat
        </button>
      )}
    </div>
  );
}
