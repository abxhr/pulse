import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export function Panel({ title, sub, right, className = "", children, accent }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-line bg-panel/80 backdrop-blur-sm shadow-panel ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            {accent && <span className="h-3.5 w-1 rounded-full" style={{ background: accent }} />}
            <div>
              <h3 className="font-display text-[13px] font-semibold tracking-wide text-txt/90 uppercase">
                {title}
              </h3>
              {sub && <p className="text-[11px] text-faint mt-0.5">{sub}</p>}
            </div>
          </div>
          {right}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
    </motion.section>
  );
}

export function StatTile({ label, value, unit, color = "#8A93A6", delta, hint }) {
  return (
    <div className="rounded-xl border border-line bg-panel2/60 px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10.5px] uppercase tracking-wider text-muted">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-txt tnum">{value ?? "—"}</span>
        {unit && <span className="text-xs text-faint">{unit}</span>}
      </div>
      {(delta || hint) && (
        <div className="mt-0.5 text-[11px] text-faint">{delta ?? hint}</div>
      )}
    </div>
  );
}

export function Chip({ children, color = "#8A93A6", solid = false }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
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
        <span className="font-mono text-xs">{label}</span>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, sub, accent, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel shadow-panel sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-5 py-4 backdrop-blur-sm">
              <div className="flex items-center gap-2.5">
                {accent && <span className="h-3.5 w-1 rounded-full" style={{ background: accent }} />}
                <div>
                  <h3 className="font-display text-sm font-semibold text-txt">{title}</h3>
                  {sub && <p className="text-[11px] text-faint">{sub}</p>}
                </div>
              </div>
              <button onClick={onClose} className="text-faint hover:text-txt"><X size={18} /></button>
            </header>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel2/40 px-6 py-8 text-center">
      <p className="font-display text-sm font-semibold text-txt">{title}</p>
      <p className="mt-1 text-xs text-muted">{body}</p>
    </div>
  );
}
