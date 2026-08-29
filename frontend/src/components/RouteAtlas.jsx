import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function cleanPoints(route) {
  const raw = (route.points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (raw.length < 4) return raw;
  const lat = median(raw.map((p) => p.lat)), lon = median(raw.map((p) => p.lon));
  const distances = raw.map((p) => Math.hypot(p.lat - lat, (p.lon - lon) * Math.cos(lat * Math.PI / 180)));
  const typical = Math.max(median(distances), .002);
  const kept = raw.filter((_, i) => distances[i] <= Math.max(typical * 12, .08));
  return kept.length >= Math.max(4, raw.length * .6) ? kept : raw;
}

function center(route) {
  const points = cleanPoints(route);
  return points.length ? { lat: median(points.map((p) => p.lat)), lon: median(points.map((p) => p.lon)) } : null;
}

function clusters(routes) {
  const groups = [];
  for (const route of routes) {
    const c = center(route);
    if (!c) continue;
    let group = groups.find((g) => Math.abs(g.lat - c.lat) < .12 && Math.abs(g.lon - c.lon) < .12);
    if (!group) { group = { ...c, routes: [] }; groups.push(group); }
    group.routes.push({ ...route, points: cleanPoints(route) });
  }
  return groups.sort((a, b) => b.routes.length - a.routes.length);
}

function pace(seconds) {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}/km`;
}

function popup(route) {
  const title = String(route.name || "Run").replace(/[<>&]/g, "");
  return `<div class="pulse-route-tip"><b>${title}</b><span>${route.date || "Date unavailable"}</span><div><strong>${route.distance_km ?? "—"}</strong> km · <strong>${route.duration_min ?? "—"}</strong> min</div><div>${pace(route.pace_s_per_km)}${route.avg_hr ? ` · ${route.avg_hr} bpm` : ""}</div></div>`;
}

export default function RouteAtlas({ routes, height = "20rem", showAreas = true }) {
  const groups = useMemo(() => clusters(routes || []), [routes]);
  const [selected, setSelected] = useState(0);
  const mapNode = useRef(null), mapRef = useRef(null), layerRef = useRef(null);
  const group = groups[Math.min(selected, Math.max(0, groups.length - 1))];

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = L.map(mapNode.current, { zoomControl: true, attributionControl: true, preferCanvas: true });
    L.tileLayer("/api/map-tiles/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap &copy; CARTO" }).addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize(false));
    observer.observe(mapNode.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !group) return;
    if (layerRef.current) layerRef.current.remove();
    const layer = L.featureGroup().addTo(map);
    layerRef.current = layer;
    for (const route of group.routes) {
      const latlngs = route.points.map((p) => [p.lat, p.lon]);
      if (latlngs.length < 2) continue;
      const glow = L.polyline(latlngs, { color: "#0ea5e9", weight: 8, opacity: .2, interactive: false }).addTo(layer);
      const line = L.polyline(latlngs, { color: "#38bdf8", weight: 3, opacity: .72, lineCap: "round" }).addTo(layer);
      line.bindTooltip(popup(route), { sticky: true, direction: "top", className: "pulse-route-tooltip" });
      line.bindPopup(popup(route), { className: "pulse-route-popup", maxWidth: 240 });
      line.on("mouseover", () => line.setStyle({ color: "#e0f7ff", weight: 5, opacity: 1 }));
      line.on("mouseout", () => line.setStyle({ color: "#38bdf8", weight: 3, opacity: .72 }));
      glow.bringToBack();
    }
    if (layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), { padding: [26, 26], maxZoom: 15 });
  }, [group]);

  if (!group) return <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-line text-xs text-faint">No valid GPS points</div>;
  return <div className="space-y-2">
    {showAreas && groups.length > 1 && <div className="flex gap-1.5 overflow-x-auto pb-1">{groups.map((area, i) => <button key={i} onClick={() => setSelected(i)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] ${i === selected ? "border-cardio/60 bg-cardio/15 text-cardio" : "border-line text-muted"}`}><MapPin size={10} className="mr-1 inline" />Area {i + 1} · {area.routes.length}</button>)}</div>}
    <div className="relative overflow-hidden rounded-xl border border-cardio/25 bg-[#071019]" style={{ height }}>
      <div ref={mapNode} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute bottom-2 left-3 z-[500] rounded-full border border-white/10 bg-black/60 px-2 py-1 font-mono text-[9px] text-white/70">HOVER OR TAP A ROUTE · AREA {selected + 1}</div>
    </div>
  </div>;
}
