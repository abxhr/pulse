import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, Flag, Gauge, Moon, Scale, Shield, Target } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtNum } from "../lib/format";
import { Chip, Modal, Panel } from "./primitives";

const tones = { training: COLORS.cardio, sleep: COLORS.sleep, nutrition: COLORS.nutrition, movement: COLORS.recovery };

function CheckIn({ open, onClose, phase, onSaved }) {
  const [form, setForm] = useState({ phase, energy: 3, soreness: 3, mood: 3, hunger: 3, stress: 3, plan_adherence: 3, context_mode: "normal", notes: "" });
  const [busy, setBusy] = useState(false);
  const fields = phase === "morning" ? [["energy","Energy"],["soreness","Soreness"],["mood","Mood"],["stress","Stress"]] : [["energy","Energy"],["hunger","Hunger"],["stress","Stress"],["plan_adherence","Plan adherence"]];
  async function save(e) { e.preventDefault(); setBusy(true); try { await api.addCheckin({...form, phase}); onSaved(); onClose(); } finally { setBusy(false); } }
  return <Modal open={open} onClose={onClose} title={`${phase === "morning" ? "Morning" : "Evening"} check-in`} sub="Adds context your sensors cannot see" accent={COLORS.recovery}>
    <form onSubmit={save} className="space-y-4">
      {fields.map(([key,label])=><label key={key} className="block"><span className="mb-1.5 flex justify-between text-xs text-muted"><span>{label}</span><b className="font-mono text-txt">{form[key]}/5</b></span><input className="w-full accent-recovery" type="range" min="1" max="5" value={form[key]} onChange={e=>setForm({...form,[key]:+e.target.value})}/></label>)}
      <label className="block text-xs text-muted">Context<select value={form.context_mode} onChange={e=>setForm({...form,context_mode:e.target.value})} className="mt-1.5 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-txt"><option value="normal">Normal</option><option value="sick">Sick</option><option value="travel">Travel</option><option value="fasting">Fasting</option><option value="injured">Injured</option></select></label>
      <textarea placeholder="Anything important? (optional)" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} className="min-h-20 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-txt"/>
      <button disabled={busy} className="w-full rounded-xl bg-recovery px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50">{busy?"Saving…":"Save check-in"}</button>
    </form>
  </Modal>;
}

function GoalEditor({ data, onSaved }) {
  const [open,setOpen]=useState(false); const [items,setItems]=useState(data||[]);
  function move(i,dir){const n=[...items],j=i+dir;if(j<0||j>=n.length)return;[n[i],n[j]]=[n[j],n[i]];setItems(n.map((x,k)=>({...x,priority:k+1})));}
  async function save(){await api.setGoals(items);setOpen(false);onSaved();}
  return <><button onClick={()=>{setItems(data);setOpen(true)}} className="text-[11px] text-muted hover:text-txt">Prioritize</button><Modal open={open} onClose={()=>setOpen(false)} title="Goal hierarchy" sub="Top goals win when recovery and ambition conflict" accent={COLORS.cardio}><div className="space-y-2">{items.map((g,i)=><div key={g.key} className="flex items-center gap-2 rounded-xl border border-line bg-panel2 p-3"><span className="w-5 font-mono text-xs text-faint">{i+1}</span><button onClick={()=>setItems(items.map(x=>x.key===g.key?{...x,active:!x.active}:x))} className={`h-5 w-9 rounded-full p-0.5 ${g.active?"bg-recovery":"bg-line"}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${g.active?"translate-x-4":""}`}/></button><span className={`flex-1 text-sm ${g.active?"text-txt":"text-faint"}`}>{g.label}</span><button onClick={()=>move(i,-1)}><ArrowUp size={15}/></button><button onClick={()=>move(i,1)}><ArrowDown size={15}/></button></div>)}</div><button onClick={save} className="mt-4 w-full rounded-xl bg-recovery py-3 text-sm font-semibold text-ink">Save priorities</button></Modal></>;
}

function Metric({label,value,sub,color=COLORS.recovery}){return <div className="rounded-xl border border-line bg-panel2/60 p-3"><div className="text-[10px] uppercase tracking-wide text-faint">{label}</div><div className="mt-1 font-mono text-xl font-semibold tnum" style={{color}}>{value??"-"}</div>{sub&&<div className="mt-1 text-[10px] text-muted">{sub}</div>}</div>}

export default function CommandCenter({ data, onRefresh }) {
  const [check,setCheck]=useState(null); if(!data)return null;
  const plan=data.plan||{}, openAlerts=(data.anomalies||[]).filter(a=>a.status==="open");
  async function ack(a,status){await api.setAnomaly(a.fingerprint,status);onRefresh();}
  return <div className="space-y-4">
    <Panel accent={COLORS.recovery} title="Your plan today" sub={`${plan.intensity||"-"} training day · deterministic from your data`} right={<div className="flex gap-2"><button onClick={()=>setCheck("morning")} className="rounded-lg border border-line px-2 py-1 text-[10px] text-muted">AM check-in</button><button onClick={()=>setCheck("evening")} className="rounded-lg border border-line px-2 py-1 text-[10px] text-muted">PM check-in</button></div>}>
      <div className="mb-4 flex flex-wrap items-center gap-2"><span className="font-mono text-3xl font-bold text-recovery">{plan.readiness_score}</span><Chip color={tones[plan.intensity]||COLORS.recovery}>{plan.intensity}</Chip>{plan.constraints?.map((x,i)=><Chip key={`${x}-${i}`} color={COLORS.effort}>{x}</Chip>)}{plan.reasons?.map((x,i)=><span key={`${x}-${i}`} className="text-[11px] text-faint">because {x}</span>)}</div>
      <div className="grid gap-2 md:grid-cols-2">{plan.actions?.map((a,i)=><div key={`${a.area}-${i}`} className="flex gap-3 rounded-xl border border-line bg-panel2/60 p-3"><span className="mt-1 h-8 w-1 rounded-full" style={{background:tones[a.area]||COLORS.muted}}/><div><div className="text-[10px] uppercase text-faint">{i+1} · {a.area}</div><div className="text-sm font-medium text-txt">{a.title}</div><div className="mt-0.5 text-xs text-muted">{a.detail}</div></div></div>)}</div>
    </Panel>
    <Panel accent={COLORS.cardio} title="Goal cockpit" sub="one view of the outcomes that matter" right={<GoalEditor data={data.goals} onSaved={onRefresh}/>}>
      <div className="mb-3 flex flex-wrap gap-1.5">{data.goals?.filter(g=>g.active).map((g,i)=><Chip key={g.key} color={i===0?COLORS.recovery:COLORS.muted}>{i+1}. {g.label}</Chip>)}</div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Cut trajectory" value={data.cut?.on_track?"On track":"Needs attention"} sub={data.cut?`${data.cut.current_kg} → ${data.cut.target_kg} kg · ${data.cut.weekly_rate_kg??"-"} kg/wk`:"Set a cut goal"} color={data.cut?.on_track?COLORS.recovery:COLORS.effort}/>
        <Metric label="Nutrition adherence" value={data.cut ? `${data.cut.nutrition_adherence_pct}%` : "-"} sub={data.cut ? `${data.cut.complete_days} complete days / 30` : "Complete days to measure"} color={COLORS.nutrition}/>
        <Metric label="Race feasibility" value={data.race ? `${data.race.score}/100` : "-"} sub={data.race ? `${data.race.label} · ${data.race.days_left} days left` : "Set a race goal"} color={COLORS.cardio}/>
        <Metric label="Strength retained" value={data.strength ? `${data.strength.score}/100` : "-"} sub={data.strength ? `${data.strength.average_change_pct > 0 ? "+" : ""}${data.strength.average_change_pct}% recent e1RM` : "More workouts needed"} color={COLORS.strength}/>
      </div>
      {data.race?.gaps?.length>0&&<div className="mt-3 rounded-xl border border-cardio/20 bg-cardio/5 p-3 text-xs text-muted"><b className="text-cardio">Race gaps: </b>{data.race.gaps.join(" · ")}</div>}
      {data.strength?.exercises?.some(x=>x.change_pct < -3)&&<div className="mt-2 rounded-xl border border-strength/20 bg-strength/5 p-3 text-xs text-muted"><b className="text-strength">Protect: </b>{data.strength.exercises.filter(x=>x.change_pct < -3).map(x=>`${x.exercise} ${x.change_pct}%`).join(" · ")}</div>}
    </Panel>
    <Panel accent={openAlerts.length?COLORS.effort:COLORS.recovery} title="Anomaly inbox" sub={`${openAlerts.length} open · acknowledge what you've seen`}>
      {openAlerts.length?<div className="space-y-2">{openAlerts.map(a=><div key={a.fingerprint} className="flex items-start gap-3 rounded-xl border border-line bg-panel2/60 p-3"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-effort"/><div className="min-w-0 flex-1"><div className="text-sm text-txt">{a.title}</div><div className="text-xs text-muted">{a.detail}</div></div><button onClick={()=>ack(a,"acknowledged")} className="rounded-lg border border-line px-2 py-1 text-[10px] text-muted hover:text-txt">Seen</button><button onClick={()=>ack(a,"resolved")} className="rounded-lg border border-recovery/20 px-2 py-1 text-[10px] text-recovery"><Check size={12}/></button></div>)}</div>:<div className="flex items-center gap-2 text-sm text-muted"><Shield size={16} className="text-recovery"/>No unresolved anomalies.</div>}
    </Panel>
    <CheckIn open={!!check} onClose={()=>setCheck(null)} phase={check||"morning"} onSaved={onRefresh}/>
  </div>;
}
