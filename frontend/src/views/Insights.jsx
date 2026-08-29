import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Sparkles, BookmarkPlus, Check, RefreshCw, ChevronDown, BrainCircuit, Mic } from "lucide-react";
import { api } from "../lib/api";
import { useVoiceInput } from "../lib/useVoiceInput";

const SUGGESTIONS = [
  "How's my recovery trending this week?",
  "Am I at risk of overtraining?",
  "Is my sleep affecting my readiness?",
  "What should my training focus be next week?",
  "Analyze my strength progress and suggest progression.",
  "What if I cut carbs 20% — how would that affect my training capacity?",
  "What if I added a third strength session per week — model the recovery tradeoff.",
];

function WeeklyDigest() {
  const [digest, setDigest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => api.weeklyDigest().then(setDigest).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try { setDigest(await api.refreshWeeklyDigest()); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  if (err || !digest) return null;
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-txt">
          <Sparkles size={14} className="text-recovery" /> This week's digest
        </span>
        <div className="flex items-center gap-2">
          {open && (
            <span onClick={(e) => { e.stopPropagation(); refresh(); }}
              className="flex items-center gap-1 text-[11px] text-faint hover:text-txt">
              <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> refresh
            </span>
          )}
          <ChevronDown size={14} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && <div className="md px-5 pb-4 text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{digest.content}</ReactMarkdown></div>}
    </div>
  );
}

function MemoryEditor() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.coachMemory().then((r) => setNotes(r.notes || "")).catch(() => {}); }, []);

  async function save() {
    await api.setCoachMemory(notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="border-b border-line px-5 py-2.5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <BrainCircuit size={12} /> {open ? "Hide preferences" : "Coach preferences"}
      </button>
      {open && (
        <div className="mt-2">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="e.g. I don't eat pork, prefer high-protein swaps, training for a half marathon in October…"
            className="w-full resize-none rounded-lg border border-line bg-ink px-3 py-2 text-xs text-txt placeholder:text-faint focus:border-recovery/50 focus:outline-none" />
          <button onClick={save} className="mt-1.5 rounded-lg border border-recovery/40 bg-recovery/10 px-3 py-1 text-[11px] font-medium text-recovery">
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Insights({ aiStatus }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [provider, setProvider] = useState(null); // null = use server default
  const [probe, setProbe] = useState(null);
  const voice = useVoiceInput((text) => setInput((prev) => (prev ? `${prev} ${text}` : text)));
  const [recipeState, setRecipeState] = useState({}); // { [messageIndex]: "saving" | "saved" | "error" }
  const endRef = useRef(null);

  async function saveAsRecipe(i, content) {
    setRecipeState((s) => ({ ...s, [i]: "saving" }));
    try {
      const extracted = await api.extractRecipe([], null, content, provider);
      await api.saveRecipe(extracted);
      setRecipeState((s) => ({ ...s, [i]: "saved" }));
    } catch {
      setRecipeState((s) => ({ ...s, [i]: "error" }));
      setTimeout(() => setRecipeState((s) => ({ ...s, [i]: undefined })), 3000);
    }
  }

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

  async function testConnection() {
    setProbe({ busy: true });
    try { setProbe(await api.aiProbe()); } catch (e) { setProbe({ error: String(e) }); }
  }

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col rounded-2xl border border-line bg-panel/80 shadow-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <button onClick={testConnection} disabled={probe?.busy} title="Non-billable provider connection test"
            className="hidden rounded-full border border-line px-2.5 py-1 text-[10px] text-muted hover:text-txt sm:block">
            {probe?.busy ? "testing…" : "test AI"}
          </button>
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

      {probe && !probe.busy && <div className="flex flex-wrap gap-2 border-b border-line px-5 py-2 text-[10px]">
        {probe.error ? <span className="text-effort">{probe.error}</span> : Object.entries(probe).map(([name,s])=><span key={name} className={s.reachable?"text-recovery":"text-effort"}>{name}: {s.reachable?"connected":s.configured?"unreachable":"not configured"}</span>)}
      </div>}

      <WeeklyDigest />
      <MemoryEditor />

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
                ? (
                  <>
                    <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                    <button onClick={() => saveAsRecipe(i, m.content)} disabled={recipeState[i] === "saving"}
                      className="mt-2 flex items-center gap-1.5 text-[11px] text-faint transition hover:text-nutrition disabled:opacity-50">
                      {recipeState[i] === "saved" ? <><Check size={12} className="text-nutrition" /> Saved to recipes</>
                        : recipeState[i] === "saving" ? "Saving…"
                        : recipeState[i] === "error" ? "Couldn't find a recipe in this reply"
                        : <><BookmarkPlus size={12} /> Save as recipe</>}
                    </button>
                  </>
                )
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
        {voice.supported && (
          <button onClick={voice.toggle} title="Voice input"
            className={`flex h-10 w-10 items-center justify-center rounded-xl border transition ${
              voice.listening ? "border-effort/50 bg-effort/15 text-effort animate-pulse" : "border-line bg-panel2 text-muted hover:text-txt"
            }`}>
            <Mic size={16} />
          </button>
        )}
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
