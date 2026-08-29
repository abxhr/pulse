import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export default function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (event) => {
      const id = crypto.randomUUID();
      setItems((current) => [...current.slice(-2), { id, ...event.detail }]);
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5000);
    };
    window.addEventListener("pulse:notice", add);
    return () => window.removeEventListener("pulse:notice", add);
  }, []);
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-3 top-20 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-96">
      {items.map((item) => {
        const ok = item.type === "success";
        const Icon = ok ? CheckCircle2 : AlertCircle;
        return (
          <div key={item.id} role={ok ? "status" : "alert"} className="pointer-events-auto flex w-full gap-3 rounded-xl border border-line bg-panel px-3 py-3 shadow-2xl">
            <Icon size={18} className={ok ? "text-recovery" : "text-effort"} />
            <div className="min-w-0 flex-1 text-sm text-txt">
              {item.message}
              {item.requestId && <div className="mt-1 font-mono text-[10px] text-faint">Reference {item.requestId.slice(0, 10)}</div>}
            </div>
            <button aria-label="Dismiss notification" onClick={() => setItems((current) => current.filter((x) => x.id !== item.id))} className="text-faint hover:text-txt"><X size={15}/></button>
          </div>
        );
      })}
    </div>
  );
}
