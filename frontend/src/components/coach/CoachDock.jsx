import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import CoachChat from "./CoachChat";

/** Floating Coach on every screen except the Coach page: one click (or Ctrl+J) from anything. */
export default function CoachDock({ view }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const hidden = view === "insights";

  useEffect(() => {
    if (hidden) return;
    const onPrompt = (e) => { setOpen(true); setPrompt(e.detail?.prompt || null); };
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("pulse:coach", onPrompt);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pulse:coach", onPrompt); window.removeEventListener("keydown", onKey); };
  }, [hidden]);

  if (hidden) return null;
  return (
    <>
      {open && (
        <div role="dialog" aria-label="Coach"
          className="safe-bottom fixed inset-0 z-[45] flex flex-col bg-ink sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[36rem] sm:max-h-[calc(100vh-7rem)] sm:w-[26rem] sm:rounded-2xl sm:bg-panel sm:shadow-2xl">
          <div className="safe-top flex items-center justify-between px-4 pb-1 pt-3">
            <span className="flex items-center gap-2 font-display text-lg font-semibold text-txt"><Sparkles size={16} className="text-recovery" aria-hidden="true" />Coach</span>
            <button onClick={() => setOpen(false)} aria-label="Close Coach" className="rounded-lg p-2 text-muted hover:text-txt"><X size={18} /></button>
          </div>
          <div className="min-h-0 flex-1"><CoachChat compact page={view} autoSend={prompt} onAutoSent={() => setPrompt(null)} /></div>
        </div>
      )}
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Open Coach (Ctrl+J)"
          className="fixed bottom-20 right-20 z-40 flex h-12 items-center gap-2 rounded-full bg-panel px-4 text-sm font-medium text-txt shadow-xl transition hover:bg-panel2 lg:bottom-6 lg:right-24">
          <Sparkles size={16} className="text-recovery" aria-hidden="true" /><span className="hidden sm:inline">Ask Coach</span>
        </button>
      )}
    </>
  );
}
