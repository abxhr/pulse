import { useState } from "react";
import { Droplets, Plus, Scale, Utensils, X } from "lucide-react";
import { api } from "../lib/api";
import { COLORS } from "../lib/format";

export default function QuickLog({ onNavigate }) {
  const [open,setOpen]=useState(false),[mode,setMode]=useState(null),[value,setValue]=useState(""),[saved,setSaved]=useState(false);
  async function submit(e){e.preventDefault();if(!value)return;if(mode==="weight")await api.logWeight({date:new Date().toISOString().slice(0,10),weight_kg:+value});else await api.addWater(+value);setSaved(true);setTimeout(()=>{setSaved(false);setOpen(false);setMode(null);setValue("")},700)}
  function meal(){setOpen(false);onNavigate("nutrition")}
  return <div className="fixed bottom-20 right-4 z-40 lg:bottom-6 lg:right-6">
    {open&&<div className="mb-3 w-72 rounded-2xl border border-line bg-panel p-3 shadow-2xl">
      <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-txt">Quick log</span><button onClick={()=>{setOpen(false);setMode(null)}}><X size={16}/></button></div>
      {!mode?<div className="grid grid-cols-3 gap-2"><button onClick={()=>setMode("weight")} className="rounded-xl bg-panel2 p-3 text-center text-xs text-muted"><Scale className="mx-auto mb-2 text-recovery" size={18}/>Weight</button><button onClick={meal} className="rounded-xl bg-panel2 p-3 text-center text-xs text-muted"><Utensils className="mx-auto mb-2 text-nutrition" size={18}/>Meal</button><button onClick={()=>setMode("water")} className="rounded-xl bg-panel2 p-3 text-center text-xs text-muted"><Droplets className="mx-auto mb-2 text-cardio" size={18}/>Water</button></div>:<form onSubmit={submit}><label className="text-xs text-muted">{mode==="weight"?"Weight (kg)":"Water (ml)"}<input autoFocus type="number" step={mode==="weight"?"0.1":"50"} value={value} onChange={e=>setValue(e.target.value)} className="mt-2 w-full rounded-xl bg-panel2 px-4 py-3 font-mono text-lg text-txt"/></label><button className="mt-3 w-full rounded-xl bg-recovery py-2.5 text-sm font-semibold text-ink">{saved?"Saved ✓":"Log now"}</button></form>}
    </div>}
    <button aria-label="Quick log" onClick={()=>setOpen(!open)} className="ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-recovery text-ink shadow-xl"><Plus size={22} className={open?"rotate-45 transition":"transition"}/></button>
  </div>;
}
