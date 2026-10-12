import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Mic, Square, RotateCcw } from "lucide-react";
import { api } from "../../lib/api";
import { invalidate } from "../../lib/useApi";
import { streamChat, applyEvent } from "../../lib/agentStream";
import { useVoiceInput } from "../../lib/useVoiceInput";
import Blocks from "./Blocks";

const STARTERS = [
  "Will I be OK for my race, and what should I do from now?",
  "What should I do today?",
  "I have an injury",
  "Log 500 ml water",
];

/** The Coach conversation. `compact` is the floating-dock variant. `autoSend` fires one prompt on mount. */
export default function CoachChat({ page, provider, compact = false, autoSend, onAutoSent, top, listen = false }) {
  const [messages, setMessages] = useState([]);   // {role, blocks, pending?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const voice = useVoiceInput((text) => setInput((prev) => (prev ? `${prev} ${text}` : text)));

  useEffect(() => {
    api.agentHistory()
      .then((h) => setMessages(h.map((m) => ({ role: m.role, blocks: m.blocks }))))
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, status]);

  const send = useCallback(async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setErr(null); setInput(""); setBusy(true); setStatus("Thinking");
    setMessages((m) => [...m, { role: "user", blocks: [{ type: "text", text: q }] }, { role: "assistant", blocks: [], pending: true }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (fn) => setMessages((m) => [...m.slice(0, -1), fn(m[m.length - 1])]);
    let mutated = false;
    try {
      await streamChat({ message: q, page, provider }, (ev) => {
        if (ev.t === "status") setStatus(ev.text);
        else if (ev.t === "error") setErr(ev.message);
        else if (ev.t === "end") mutated = ev.mutated;
        else { setStatus(""); patch((last) => ({ ...last, blocks: applyEvent(last.blocks, ev) })); }
      }, ctrl.signal);
    } catch (e) {
      if (e.name !== "AbortError") setErr(String(e.message || e));
    } finally {
      patch((last) => ({ ...last, pending: false }));
      setBusy(false); setStatus("");
      if (mutated) { invalidate(); window.dispatchEvent(new Event("pulse:data-changed")); }
    }
  }, [input, busy, page, provider]);

  useEffect(() => { if (autoSend && loaded) { send(autoSend); onAutoSent?.(); } }, [autoSend, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!listen) return;
    const on = (e) => sendRef.current(e.detail?.prompt);
    window.addEventListener("pulse:coach", on);
    return () => window.removeEventListener("pulse:coach", on);
  }, [listen]);

  async function reset() {
    abortRef.current?.abort();
    await api.clearAgentHistory().catch(() => {});
    setMessages([]); setErr(null);
  }

  const empty = loaded && messages.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite" aria-busy={busy}>
        {top}
        {empty && (
          <div className="py-4">
            <p className="font-display text-xl font-semibold text-txt">What do you need?</p>
            <p className="mt-1 max-w-prose text-sm text-muted">I can read your data, log things, change your plan and chart anything. Tell me what's going on.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full bg-panel2 px-3.5 py-2 text-sm text-muted transition hover:text-txt">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-panel2 px-4 py-2.5 text-[15px] text-txt">{m.blocks[0]?.text}</div>
          </div>
        ) : (
          <div key={i} className="max-w-full">
            <Blocks blocks={m.blocks} onSend={send} />
            {m.pending && !m.blocks.length && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-recovery" aria-hidden="true" />}
          </div>
        ))}
        {busy && status && <div className="flex items-center gap-2 text-sm text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-recovery" aria-hidden="true" />{status}…</div>}
        {err && <div role="alert" className="rounded-xl bg-effort/10 px-4 py-3 text-sm text-effort">{/not set|configured/i.test(err) ? "Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env and restart the server." : err}</div>}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 p-3">
        {!compact && messages.length > 0 && (
          <button onClick={reset} title="Start a new conversation" aria-label="Start a new conversation" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel2 text-muted hover:text-txt"><RotateCcw size={16} /></button>
        )}
        <textarea aria-label="Message the Coach" value={input} rows={1} placeholder="Tell me, ask me, or have me change something…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="max-h-32 min-w-0 flex-1 resize-none rounded-xl bg-panel2 px-4 py-2.5 text-[15px] text-txt outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-recovery/50" />
        {voice.supported && (
          <button onClick={voice.toggle} title="Voice input" aria-label="Voice input"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${voice.listening ? "animate-pulse bg-effort/15 text-effort" : "bg-panel2 text-muted hover:text-txt"}`}><Mic size={16} /></button>
        )}
        {busy ? (
          <button onClick={() => abortRef.current?.abort()} aria-label="Stop" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel2 text-txt"><Square size={14} /></button>
        ) : (
          <button onClick={() => send()} disabled={!input.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-recovery text-ink transition hover:opacity-90 disabled:opacity-40"><Send size={16} /></button>
        )}
      </div>
    </div>
  );
}
