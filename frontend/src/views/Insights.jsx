import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Sparkles } from "lucide-react";
import { api } from "../lib/api";

const SUGGESTIONS = [
  "How's my recovery trending this week?",
  "Am I at risk of overtraining?",
  "Is my sleep affecting my readiness?",
  "What should my training focus be next week?",
  "Analyze my strength progress and suggest progression.",
];

export default function Insights({ aiStatus }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [provider, setProvider] = useState(null); // null = use server default
  const endRef = useRef(null);

  const options = [
    { id: null, label: "Auto" },
    { id: "anthropic", label: "Claude", ok: aiStatus?.anthropic },
    { id: "openai", label: "GPT", ok: aiStatus?.openai },
  ];

  useEffect(() => {
    api.insightHistory().then((h) =>
      setMessages(h.map((m) => ({ role: m.role, content: m.content })))
    ).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setErr(null);
    setInput("");
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await api.insight({ question: q, history, provider });
      setMessages((m) => [...m, { role: "assistant", content: res.content }]);
    } catch (e) {
      setErr(String(e).includes("not set")
        ? "Add your AI key to .env (ANTHROPIC_API_KEY or OPENAI_API_KEY) and restart the server."
        : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col rounded-2xl border border-line bg-panel/80 shadow-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-recovery" />
          <h3 className="font-display text-sm font-semibold text-txt">Coach</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[10px] text-faint sm:inline">sees last 30 days ·</span>
          <div className="flex gap-1 rounded-full bg-panel2 p-0.5">
            {options.map((o) => (
              <button key={o.label} onClick={() => setProvider(o.id)}
                disabled={o.id && o.ok === false}
                title={o.id && o.ok === false ? `${o.label} key not configured` : undefined}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  provider === o.id ? "bg-recovery text-ink" : "text-muted hover:text-txt"
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-6 max-w-lg text-center">
            <p className="font-display text-lg text-txt">Ask about your body.</p>
            <p className="mt-1 text-sm text-muted">
              I read your recent sleep, HRV, readiness, runs and lifts, then answer with the actual numbers.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              m.role === "user"
                ? "bg-cardio/15 text-txt border border-cardio/25"
                : "bg-panel2/70 border border-line"
            }`}>
              {m.role === "assistant"
                ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                : m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-panel2/70 px-4 py-3">
              <span className="h-2 w-2 animate-pulse rounded-full bg-recovery" />
              <span className="font-mono text-xs text-muted">analyzing your telemetry…</span>
            </div>
          </div>
        )}
        {err && <div className="rounded-lg border border-effort/30 bg-effort/10 px-4 py-2.5 text-xs text-effort">{err}</div>}
        <div ref={endRef} />
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}
              className="rounded-full border border-line bg-panel2/60 px-3 py-1.5 text-xs text-muted transition hover:border-recovery/40 hover:text-txt">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Ask your coach…"
          className="max-h-32 flex-1 resize-none rounded-xl border border-line bg-panel2/60 px-4 py-2.5 text-sm text-txt outline-none placeholder:text-faint focus:border-recovery/40"
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-recovery text-ink transition hover:opacity-90 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
