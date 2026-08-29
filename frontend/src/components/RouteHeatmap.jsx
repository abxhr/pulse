import { useEffect, useState } from "react";
import { Map as MapIcon, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { COLORS } from "../lib/format";
import { Panel } from "./primitives";
import RouteAtlas from "./RouteAtlas";

export default function RouteHeatmap(){
 const [data,setData]=useState(null),[syncing,setSyncing]=useState(false),[error,setError]=useState(null);const load=()=>api.routeHeatmap().then(setData).catch(e=>setError(String(e)));useEffect(()=>{load()},[]);
 async function syncMore(){setSyncing(true);setError(null);try{let done=false;while(!done){const r=await api.syncRouteHeatmap(8);done=r.done}await load()}catch(e){setError(String(e))}finally{setSyncing(false)}}
 if(!data&&!error)return null;const missing=(data?.total_runs||0)-(data?.cached_count||0);
 return <Panel accent={COLORS.cardio} title="Route atlas" sub={data?`${data.cached_count} of ${data.total_runs} runs mapped · visible offline`:"GPS route library"} right={missing>0&&<button onClick={syncMore} disabled={syncing} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[11px] text-muted"><RefreshCw size={12} className={syncing?"animate-spin":""}/>{syncing?"Loading…":`Load ${missing} more`}</button>}>
  {error&&<div className="mb-2 rounded-lg border border-effort/20 bg-effort/5 p-2 text-xs text-effort">{error}</div>}{data?.routes?.length?<RouteAtlas routes={data.routes}/>:<div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line"><MapIcon size={20} className="text-faint"/><p className="text-xs text-faint">No GPS tracks cached yet.</p></div>}
 </Panel>
}
