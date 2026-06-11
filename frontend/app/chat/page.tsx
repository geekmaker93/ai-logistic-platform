import LiveChatSupport from "@/app/components/live-chat-support";

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Support</p>
          <h1 className="text-3xl font-semibold text-white">Live Chat</h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Connect directly with support from a standalone page instead of the homepage widget.
          </p>
        </header>
        <LiveChatSupport initialOpen standalone />
      </div>
    </main>
  );
}
