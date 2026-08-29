import { useEffect, useState } from "react";
import { api } from "../lib/api";
import RouteAtlas from "./RouteAtlas";
export default function RouteMap({activityId}){const [points,setPoints]=useState(null);useEffect(()=>{let live=true;api.activityRoute(activityId).then(r=>{if(live)setPoints(r.points||[])}).catch(()=>{if(live)setPoints([])});return()=>{live=false}},[activityId]);if(points===null)return <div className="h-56 animate-pulse rounded-xl border border-line bg-panel2/60"/>;if(!points.length)return null;return <div><div className="mb-2 text-[10.5px] uppercase tracking-wider text-faint">Route</div><RouteAtlas routes={[{id:activityId,points}]} height="14rem" showAreas={false}/></div>}
