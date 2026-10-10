import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

export default function HevyStatus() {
  const [data,setData]=useState(null); const [busy,setBusy]=useState(false);
  const load=()=>{api.hevyStatus().then(setData).catch(()=>{});};
  useEffect(()=>{load();},[]);
  if(!data) return null;
  async function sync(){setBusy(true);try{await api.syncHevy();load();}finally{setBusy(false);}}
  return <div className={`rounded-xl border px-4 py-3 ${data.stale?"border-strength/30 bg-strength/5":"border-recovery/20 bg-recovery/5"}`}>
    <div className="flex items-start gap-3">{data.stale?<AlertTriangle size={16} className="mt-0.5 shrink-0 text-strength"/>:<CheckCircle2 size={16} className="mt-0.5 shrink-0 text-recovery"/>}<div className="min-w-0 flex-1"><p className="text-xs font-medium text-txt">Hevy detail · {data.automatic?"automatic":"CSV watched-folder mode"}</p><p className="mt-0.5 text-xs text-muted">{data.latest_workout?`Latest detailed workout ${fmtDate(data.latest_workout)}${data.stale?` · ${data.age_days} days old`:""}`:"No detailed workouts imported"}</p>{data.action&&<details className="mt-2"><summary className="cursor-pointer text-xs text-strength">Enable hands-free Hevy sync</summary><p className="mt-1 rounded-lg bg-panel2 p-2 font-mono text-xs text-muted">{data.action}</p></details>}</div><button aria-label="Sync Hevy now" disabled={busy} onClick={sync} className="rounded-lg border border-line p-2 text-muted"><RefreshCw size={13} className={busy?"animate-spin":""}/></button></div>
  </div>;
}
