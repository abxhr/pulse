import { AlertTriangle, CheckCircle2, Database } from "lucide-react";
import { fmtDate } from "../lib/format";

export function FreshnessBadge({ item, compact=false }) {
  if (!item) return null;
  const stale=item.stale;
  return <span title={`${item.label} · source: ${item.source}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${stale?"border-strength/30 bg-strength/10 text-strength":"border-recovery/20 bg-recovery/10 text-recovery"}`}>
    {stale?<AlertTriangle size={10}/>:<CheckCircle2 size={10}/>} {compact ? (stale?"stale":"current") : `${item.latest_date?`as of ${fmtDate(item.latest_date)}`:"no data"} · ${item.source}`}
  </span>;
}

export default function DataFreshness({ data }) {
  if(!data) return null;
  const stale=Object.entries(data.sources||{}).filter(([,v])=>v.stale);
  if(!stale.length) return null;
  return <div className="rounded-xl border border-strength/25 bg-strength/5 px-4 py-3">
    <div className="flex items-start gap-2"><Database size={15} className="mt-0.5 shrink-0 text-strength"/><div className="min-w-0"><p className="text-xs font-medium text-txt">Some inputs are stale or missing</p><div className="mt-2 flex flex-wrap gap-1.5">{stale.map(([key,item])=><FreshnessBadge key={key} item={item}/>)}</div></div></div>
  </div>;
}
