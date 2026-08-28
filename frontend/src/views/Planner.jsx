import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Dumbbell, Footprints, RefreshCw, Settings2, SkipForward } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, axisLabelStyle, fmtDate, fmtNum } from "../lib/format";
import { Chip, Empty, Loading, Modal, Panel } from "../components/primitives";

const KIND={run:{icon:Footprints,color:COLORS.cardio},strength:{icon:Dumbbell,color:COLORS.strength},recovery:{icon:RefreshCw,color:COLORS.recovery}};
const DAY=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const iso=d=>d.toISOString().slice(0,10);
function shiftWeek(start,n){const d=new Date(`${start}T12:00:00`);d.setDate(d.getDate()+n*7);return iso(d)}
function targetText(t){if(!t)return null;return Object.entries(t).map(([k,v])=>`${k.replaceAll("_"," ")} ${v}`).join(" · ")}

function SettingsModal({open,onClose,data,onSaved}){
  const [f,setF]=useState(data||{});useEffect(()=>setF(data||{}),[data,open]);
  async function save(e){e.preventDefault();await api.setPlannerSettings(f);await onSaved();onClose()}
  return <Modal open={open} onClose={onClose} title="Planning constraints" sub="The generator still adapts volume from your actual training" accent={COLORS.cardio}><form onSubmit={save} className="space-y-4">
    {[['run_days','Runs per week',1,6],['strength_days','Strength days',1,6]].map(([k,l,min,max])=><label key={k} className="block text-xs text-muted">{l}<input type="number" min={min} max={max} value={f[k]??3} onChange={e=>setF({...f,[k]:+e.target.value})} className="mt-1.5 w-full rounded-xl border border-line bg-panel2 px-3 py-2 font-mono text-txt"/></label>)}
    {[['long_run_weekday','Long run day'],['preferred_rest_weekday','Recovery day']].map(([k,l])=><label key={k} className="block text-xs text-muted">{l}<select value={f[k]??0} onChange={e=>setF({...f,[k]:+e.target.value})} className="mt-1.5 w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-txt">{DAY.map((d,i)=><option value={i} key={d}>{d}</option>)}</select></label>)}
    <button className="w-full rounded-xl bg-cardio py-3 text-sm font-semibold text-ink">Save and regenerate</button>
  </form></Modal>
}

function DayCard({date,sessions,fuel,onUpdate}){
  const today=iso(new Date())===date; const weekday=DAY[(new Date(`${date}T12:00:00`).getDay()+6)%7];
  return <div className={`rounded-2xl border p-3 ${today?"border-recovery/50 bg-recovery/5":"border-line bg-panel/70"}`}>
    <div className="mb-3 flex items-center justify-between"><div><div className="text-[10px] uppercase text-faint">{weekday}{today?" · today":""}</div><div className="font-mono text-sm text-txt">{fmtDate(date)}</div></div>{fuel&&<Chip color={COLORS.nutrition}>{fuel.calories} kcal</Chip>}</div>
    <div className="space-y-2">{sessions.length?sessions.map(s=>{const meta=KIND[s.kind]||KIND.recovery,Icon=meta.icon;return <div key={s.id} className={`rounded-xl border border-line bg-panel2/70 p-3 ${s.status==="completed"?"opacity-60":""}`}><div className="flex items-start gap-2"><Icon size={15} style={{color:meta.color}} className="mt-0.5 shrink-0"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-txt">{s.title}{s.auto_completed&&<Chip color={COLORS.recovery}>synced</Chip>}{s.status==="skipped"&&<Chip color={COLORS.faint}>skipped</Chip>}</div><div className="mt-1 text-[11px] text-muted">{s.details}</div>{s.target&&<div className="mt-1 font-mono text-[10px] text-faint">{targetText(s.target)}</div>}</div></div>{s.status==="planned"&&s.kind!=="recovery"&&<div className="mt-2 flex gap-2"><button onClick={()=>onUpdate(s.id,{status:"completed"})} className="flex items-center gap-1 rounded-lg border border-recovery/30 px-2 py-1 text-[10px] text-recovery"><Check size={11}/>Done</button><button onClick={()=>onUpdate(s.id,{status:"skipped"})} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10px] text-muted"><SkipForward size={11}/>Skip</button><input aria-label="Reschedule" title="Reschedule" type="date" value={s.date} onChange={e=>onUpdate(s.id,{date:e.target.value})} className="ml-auto min-w-0 rounded-lg border border-line bg-panel px-2 py-1 text-[10px] text-muted"/></div>}</div>}):<div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-faint">Open / rest day</div>}</div>
    {fuel&&<div className="mt-2 text-[10px] text-faint">{fuel.day_type} · P {fuel.protein_g}g · C {fuel.carbs_g}g · F {fuel.fat_g}g</div>}
  </div>
}

export default function Planner(){
  const [start,setStart]=useState(null),[data,setData]=useState(null),[forecast,setForecast]=useState([]),[err,setErr]=useState(null),[settingsOpen,setSettingsOpen]=useState(false),[busy,setBusy]=useState(false);
  async function load(s=start){try{const p=await api.plannerWeek(s);setData(p);setStart(p.start);setForecast(await api.recoveryForecast())}catch(e){setErr(String(e))}}
  useEffect(()=>{load(null)},[]);
  async function update(id,body){await api.updatePlannedSession(id,body);load()}
  async function regenerate(){setBusy(true);try{setData(await api.regeneratePlan(start));setForecast(await api.recoveryForecast())}finally{setBusy(false)}}
  async function saveSettings(){await regenerate()}
  if(err)return <Empty title="Couldn't load plan" body={err}/>;if(!data)return <Loading label="Building your week…"/>;
  const days=Array.from({length:7},(_,i)=>{const d=new Date(`${data.start}T12:00:00`);d.setDate(d.getDate()+i);return iso(d)});const byDate=Object.groupBy?Object.groupBy(data.sessions,s=>s.date):data.sessions.reduce((a,s)=>((a[s.date]??=[]).push(s),a),{});const fuel=Object.fromEntries((data.nutrition_targets||[]).map(x=>[x.date,x]));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><button onClick={()=>load(shiftWeek(start,-1))} className="rounded-lg border border-line p-2"><ChevronLeft size={16}/></button><div><h2 className="font-display text-lg font-semibold text-txt">Adaptive week</h2><p className="text-xs text-muted">{fmtDate(data.start)} – {fmtDate(data.end)}</p></div><button onClick={()=>load(shiftWeek(start,1))} className="rounded-lg border border-line p-2"><ChevronRight size={16}/></button><div className="ml-auto flex gap-2"><button onClick={()=>setSettingsOpen(true)} className="rounded-lg border border-line p-2"><Settings2 size={15}/></button><button onClick={regenerate} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs"><RefreshCw size={13} className={busy?"animate-spin":""}/>Adapt future</button></div></div>
    {data.deload?.recommended&&<div className="rounded-2xl border border-effort/30 bg-effort/5 p-4"><div className="font-display text-sm font-semibold text-effort">Deload recommended</div><div className="mt-1 text-xs text-muted">Volume reduced to {Math.round(data.deload.volume_multiplier*100)}% because {data.deload.reasons.join(" and ")}.</div></div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-line bg-panel p-3"><div className="text-[10px] uppercase text-faint">Adherence</div><div className="mt-1 font-mono text-2xl text-recovery">{data.adherence_pct??"—"}%</div></div><div className="rounded-xl border border-line bg-panel p-3"><div className="text-[10px] uppercase text-faint">Completed</div><div className="mt-1 font-mono text-2xl text-txt">{data.completed}/{data.due}</div></div><div className="rounded-xl border border-line bg-panel p-3"><div className="text-[10px] uppercase text-faint">Runs</div><div className="mt-1 font-mono text-2xl text-cardio">{data.sessions.filter(x=>x.kind==="run").length}</div></div><div className="rounded-xl border border-line bg-panel p-3"><div className="text-[10px] uppercase text-faint">Lifts</div><div className="mt-1 font-mono text-2xl text-strength">{data.sessions.filter(x=>x.kind==="strength").length}</div></div></div>
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{days.map(d=><DayCard key={d} date={d} sessions={byDate[d]||[]} fuel={fuel[d]} onUpdate={update}/>)}</div>
    <Panel accent={COLORS.recovery} title="Recovery forecast" sub="Banister fitness/fatigue projection using this week's planned load"><ResponsiveContainer width="100%" height={220}><ComposedChart data={forecast} margin={{left:-12,right:8,top:8}}><CartesianGrid stroke="#1c2230" vertical={false}/><XAxis dataKey="date" tick={{fontSize:10,fill:"#5b6479"}} tickFormatter={fmtDate}/><YAxis tick={{fontSize:10,fill:"#5b6479"}} label={{value:"load / form",angle:-90,position:"insideLeft",style:axisLabelStyle}}/><Tooltip/><Area dataKey="form" name="Form" fill={`${COLORS.recovery}22`} stroke={COLORS.recovery}/><Line dataKey="fatigue" name="Fatigue" stroke={COLORS.effort} dot={false}/><Line dataKey="fitness" name="Fitness" stroke={COLORS.cardio} dot={false}/></ComposedChart></ResponsiveContainer></Panel>
    <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} data={data.settings} onSaved={saveSettings}/>
  </div>
}
