import { useEffect, useId, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

/** A tonal surface: separated from the page by fill, not by a border or shadow.
 *  `accent` is accepted for call-site compatibility but no longer draws decoration. */
export function Panel({ title, sub, right, className = "", children }) {
  return (
    <section className={`rounded-xl bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-semibold leading-tight text-txt">{title}</h3>
            {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

/** A scoreboard figure: big condensed numeral, plain-language label, and a
 *  hairline in the domain colour (colour means "which part of your body this is"). */
export function StatTile({ label, value, unit, color = "var(--color-faint)", delta, hint }) {
  return (
    <div className="border-l-2 py-1 pl-3.5" style={{ borderColor: color }}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-num text-4xl font-semibold leading-none text-txt tnum">{value ?? "-"}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      <div className="mt-1.5 text-sm text-muted">{label}</div>
      {(delta || hint) && <div className="text-xs text-faint">{delta ?? hint}</div>}
    </div>
  );
}

export function Chip({ children, color = "#8A93A6", solid = false }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        solid
          ? { background: color, color: "#0B0E14" }
          : { background: `${color}1a`, color, border: `1px solid ${color}33` }
      }
    >
      {children}
    </span>
  );
}

export function Loading({ label = "Reading telemetry…" }) {
  return (
    <div className="flex h-full min-h-[300px] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-cardio" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, sub, accent, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus?.(); };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-panel shadow-2xl sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-4">
              <div className="flex items-center gap-2.5">
                                <div>
                  <h3 id={titleId} className="font-display text-xl font-semibold text-txt">{title}</h3>
                  {sub && <p className="text-xs text-faint">{sub}</p>}
                </div>
              </div>
              <button aria-label={`Close ${title}`} onClick={onClose} className="rounded-lg p-2 text-faint hover:text-txt"><X size={18} /></button>
            </header>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ title, body, action }) {
  return (
    <div className="rounded-xl bg-panel2 px-6 py-8">
      <p className="font-display text-lg font-semibold text-txt">{title}</p>
      {body && <p className="mt-1 max-w-prose text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

/** Failed fetch: say what failed and offer the fix. */
export function ErrorState({ title = "Couldn't load this", detail, onRetry }) {
  return (
    <div role="alert" className="rounded-xl bg-effort/10 px-5 py-4">
      <p className="font-display text-lg font-semibold text-txt">{title}</p>
      {detail && <p className="mt-0.5 text-sm text-muted">{detail}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg bg-panel2 px-3 py-2 text-sm font-medium text-txt hover:bg-line">
          Try again
        </button>
      )}
    </div>
  );
}
