import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, Flag, Gauge, Moon, Scale, Shield, Target } from "lucide-react";
import { api } from "../lib/api";
import { COLORS } from "../lib/format";
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
      <label className="block text-xs text-muted">Context<select value={form.context_mode} onChange={e=>setForm({...form,context_mode:e.target.value})} className="mt-1.5 w-full rounded-lg bg-panel2 px-3 py-2 text-txt"><option value="normal">Normal</option><option value="sick">Sick</option><option value="travel">Travel</option><option value="fasting">Fasting</option><option value="injured">Injured</option></select></label>
      <textarea aria-label="Anything important? (optional)" placeholder="Anything important? (optional)" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} className="min-h-20 w-full rounded-lg bg-panel2 px-3 py-2 text-sm text-txt"/>
      <button disabled={busy} className="w-full rounded-xl bg-recovery px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50">{busy?"Saving…":"Save check-in"}</button>
    </form>
  </Modal>;
}

function GoalEditor({ data, onSaved }) {
  const [open,setOpen]=useState(false); const [items,setItems]=useState(data||[]);
  function move(i,dir){const n=[...items],j=i+dir;if(j<0||j>=n.length)return;[n[i],n[j]]=[n[j],n[i]];setItems(n.map((x,k)=>({...x,priority:k+1})));}
  async function save(){await api.setGoals(items);setOpen(false);onSaved();}
  return <><button onClick={()=>{setItems(data);setOpen(true)}} className="text-xs text-muted hover:text-txt">Prioritize</button><Modal open={open} onClose={()=>setOpen(false)} title="Goal hierarchy" sub="Top goals win when recovery and ambition conflict" accent={COLORS.cardio}><div className="space-y-2">{items.map((g,i)=><div key={g.key} className="flex items-center gap-2 rounded-xl bg-panel2 p-3"><span className="w-5 font-mono text-xs text-faint">{i+1}</span><button onClick={()=>setItems(items.map(x=>x.key===g.key?{...x,active:!x.active}:x))} className={`h-5 w-9 rounded-full p-0.5 ${g.active?"bg-recovery":"bg-line"}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${g.active?"translate-x-4":""}`}/></button><span className={`flex-1 text-sm ${g.active?"text-txt":"text-faint"}`}>{g.label}</span><button onClick={()=>move(i,-1)}><ArrowUp size={15}/></button><button onClick={()=>move(i,1)}><ArrowDown size={15}/></button></div>)}</div><button onClick={save} className="mt-4 w-full rounded-xl bg-recovery py-3 text-sm font-semibold text-ink">Save priorities</button></Modal></>;
}

/** A goal readout: big numeral, what it measures, one line of context. */
function Goal({ label, value, sub, color }) {
  return (
    <div className="border-l-2 py-1 pl-3.5" style={{ borderColor: color }}>
      <div className="font-num text-3xl font-semibold leading-none tnum">{value ?? "-"}</div>
      <div className="mt-1.5 text-sm text-muted">{label}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

const STALE = /stale/i;

export default function CommandCenter({ data, onRefresh }) {
  const [check, setCheck] = useState(null);
  if (!data) return null;
  const plan = data.plan || {};
  const open = (data.anomalies || []).filter((a) => a.status === "open");
  // Out-of-date sources are housekeeping, not alarms: fold them into one quiet line.
  const stale = open.filter((a) => STALE.test(a.title));
  const alerts = open.filter((a) => !STALE.test(a.title));
  const ack = async (a, status) => { await api.setAnomaly(a.fingerprint, status); onRefresh(); };
  const tone = tones[plan.intensity] || COLORS.recovery;

  return (
    <div className="space-y-4">
      <Panel
        title="Today's plan"
        sub={plan.intensity ? `A ${plan.intensity} day, worked out from your recovery and training data` : undefined}
        right={
          <div className="flex gap-2">
            <button onClick={() => setCheck("morning")} className="rounded-lg bg-panel2 px-3 py-2 text-sm text-muted hover:text-txt">Morning check-in</button>
            <button onClick={() => setCheck("evening")} className="rounded-lg bg-panel2 px-3 py-2 text-sm text-muted hover:text-txt">Evening check-in</button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-num text-5xl font-semibold leading-none tnum" style={{ color: tone }}>{plan.readiness_score ?? "-"}</span>
          <span className="text-sm text-muted">readiness{plan.intensity ? `, ${plan.intensity}` : ""}</span>
          {plan.constraints?.map((x, i) => <Chip key={`${x}-${i}`} color={COLORS.effort}>{x}</Chip>)}
        </div>
        {plan.reasons?.length > 0 && <p className="mb-4 max-w-prose text-sm text-muted">Because {plan.reasons.join("; ")}.</p>}
        <ul className="divide-y divide-line">
          {plan.actions?.map((a, i) => (
            <li key={`${a.area}-${i}`} className="flex gap-4 py-3">
              <span className="w-20 shrink-0 text-sm font-medium capitalize" style={{ color: tones[a.area] || COLORS.muted }}>{a.area}</span>
              <div className="min-w-0">
                <div className="font-medium text-txt">{a.title}</div>
                <div className="text-sm text-muted">{a.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Goals" sub={data.goals?.filter((g) => g.active).map((g, i) => `${i + 1}. ${g.label}`).join("   ")}
        right={<GoalEditor data={data.goals} onSaved={onRefresh} />}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-4">
          <Goal label="Cut trajectory" color={data.cut?.on_track ? COLORS.recovery : COLORS.effort}
            value={data.cut ? (data.cut.on_track ? "On track" : "Behind") : "-"}
            sub={data.cut ? `${data.cut.current_kg} to ${data.cut.target_kg} kg, ${data.cut.weekly_rate_kg ?? "-"} kg/wk` : "Set a cut goal"} />
          <Goal label="Nutrition adherence" color={COLORS.nutrition}
            value={data.cut ? `${data.cut.nutrition_adherence_pct}%` : "-"}
            sub={data.cut ? `${data.cut.complete_days} of 30 days fully logged` : "Log full days to measure this"} />
          <Goal label="Race feasibility" color={COLORS.cardio}
            value={data.race ? `${data.race.score}/100` : "-"}
            sub={data.race ? `${data.race.label}, ${data.race.days_left} days left` : "Set a race goal"} />
          <Goal label="Strength retained" color={COLORS.strength}
            value={data.strength ? `${data.strength.score}/100` : "-"}
            sub={data.strength ? `${data.strength.average_change_pct > 0 ? "+" : ""}${data.strength.average_change_pct}% recent e1RM` : "Log more workouts"} />
        </div>
        {data.race?.gaps?.length > 0 && <p className="mt-4 text-sm text-muted"><b className="font-semibold text-cardio">Race gaps:</b> {data.race.gaps.join("; ")}</p>}
        {data.strength?.exercises?.some((x) => x.change_pct < -3) && (
          <p className="mt-2 text-sm text-muted"><b className="font-semibold text-strength">Protect:</b> {data.strength.exercises.filter((x) => x.change_pct < -3).map((x) => `${x.exercise} ${x.change_pct}%`).join("; ")}</p>
        )}
      </Panel>

      {alerts.length > 0 && (
        <Panel title="Needs your attention" sub={`${alerts.length} open`}>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.fingerprint} className="flex items-start gap-3 rounded-lg bg-panel2 p-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-effort" aria-hidden="true" />
                <div className="min-w-0 flex-1"><div className="text-txt">{a.title}</div><div className="text-sm text-muted">{a.detail}</div></div>
                <button onClick={() => ack(a, "acknowledged")} className="rounded-lg bg-panel px-3 py-2 text-sm text-muted hover:text-txt">Got it</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {stale.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>Out of date: {stale.map((a) => a.title.replace(/ data is stale$/i, "")).join(", ")}.</span>
          <button onClick={() => stale.forEach((a) => ack(a, "acknowledged"))} className="text-faint underline underline-offset-2 hover:text-txt">Dismiss</button>
        </p>
      )}
      <CheckIn open={!!check} onClose={() => setCheck(null)} phase={check || "morning"} onSaved={onRefresh} />
    </div>
  );
}
