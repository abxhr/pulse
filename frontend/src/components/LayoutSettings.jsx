import { ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw, LayoutGrid } from "lucide-react";
import { Modal } from "./primitives";
import { COLORS } from "../lib/format";

export default function LayoutSettings({ open, onClose, sections, layout }) {
  const { order, hidden, move, toggleHidden, reset } = layout;
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));

  return (
    <Modal open={open} onClose={onClose} title="Customize Overview" sub="Reorder or hide panels — saved on this device" accent={COLORS.recovery}>
      <div className="space-y-1.5">
        {order.map((id, i) => {
          const s = byId[id];
          if (!s) return null;
          const isHidden = hidden.includes(id);
          return (
            <div key={id}
              className={`flex items-center gap-2 rounded-lg border border-line px-3 py-2 ${isHidden ? "opacity-50" : ""}`}>
              <div className="flex flex-col">
                <button onClick={() => move(id, -1)} disabled={i === 0} className="text-faint hover:text-txt disabled:opacity-30">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => move(id, 1)} disabled={i === order.length - 1} className="text-faint hover:text-txt disabled:opacity-30">
                  <ChevronDown size={14} />
                </button>
              </div>
              <span className="flex-1 text-sm text-txt">{s.label}</span>
              <button onClick={() => toggleHidden(id)} className="text-faint hover:text-txt">
                {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          );
        })}
      </div>
      <button onClick={reset} className="mt-4 flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <RotateCcw size={12} /> Reset to default layout
      </button>
    </Modal>
  );
}

export function CustomizeButton({ onClick }) {
  return (
    <button onClick={onClick} title="Customize layout"
      className="flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[11px] text-muted transition hover:border-recovery/40 hover:text-txt">
      <LayoutGrid size={13} />
    </button>
  );
}
