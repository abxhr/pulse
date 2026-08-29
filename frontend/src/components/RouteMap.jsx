import { useEffect, useState } from "react";
import { api } from "../lib/api";
import RouteAtlas from "./RouteAtlas";
export default function RouteMap({activityId}){const [route,setRoute]=useState(null);useEffect(()=>{let live=true;api.activityRoute(activityId).then(r=>{if(live)setRoute(r)}).catch(()=>{if(live)setRoute({points:[]})});return()=>{live=false}},[activityId]);if(route===null)return <div className="h-56 animate-pulse rounded-xl border border-line bg-panel2/60"/>;if(!route.points?.length)return null;return <div><div className="mb-2 text-[10.5px] uppercase tracking-wider text-faint">Route</div><RouteAtlas routes={[route]} height="14rem" showAreas={false}/></div>}
