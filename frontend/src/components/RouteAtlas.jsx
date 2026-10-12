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
  if (!seconds) return "-";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}/km`;
}

function bundles(routes) {
  const result = [];
  for (const route of routes) {
    const c = center(route), distance = route.distance_km || 0;
    let bundle = result.find((b) => {
      const close = Math.abs(b.lat - c.lat) < .012 && Math.abs(b.lon - c.lon) < .012;
      const similarDistance = !distance || !b.distance || Math.abs(distance - b.distance) / Math.max(distance, b.distance) < .28;
      return close && similarDistance;
    });
    if (!bundle) { bundle = { ...c, distance, runs: [], points: route.points }; result.push(bundle); }
    bundle.runs.push(route);
    if (route.points.length > bundle.points.length) bundle.points = route.points;
  }
  return result.sort((a, b) => b.runs.length - a.runs.length);
}

function safe(value) { return String(value ?? "").replace(/[<>&]/g, ""); }
function avg(runs, key) {
  const values = runs.map((r) => Number(r[key])).filter((v) => Number.isFinite(v) && v > 0);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function popup(bundle) {
  const runs = [...bundle.runs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const distance = avg(runs, "distance_km"), averagePace = avg(runs, "pace_s_per_km"), heartRate = avg(runs, "avg_hr");
  const heading = runs.length > 1 ? `${runs.length} similar runs` : safe(runs[0]?.name || "Run");
  const rows = runs.slice(0, 5).map((r) => `<div class="pulse-route-run"><span>${safe(r.date || "-")}</span><b>${Number(r.distance_km || 0).toFixed(1)} km</b><span>${pace(r.pace_s_per_km)}</span></div>`).join("");
  return `<div class="pulse-route-tip pulse-route-group"><b>${heading}</b><span>${runs.length > 1 ? "Combined route summary" : safe(runs[0]?.date || "Date unavailable")}</span><div class="pulse-route-averages"><strong>${distance?.toFixed(1) ?? "-"} km</strong><strong>${pace(averagePace)}</strong><strong>${heartRate ? Math.round(heartRate) + " bpm" : "-"}</strong></div>${runs.length > 1 ? `<div class="pulse-route-runs">${rows}${runs.length > 5 ? `<small>+ ${runs.length - 5} more runs</small>` : ""}</div>` : ""}</div>`;
}

export default function RouteAtlas({ routes, height = "20rem", showAreas = true }) {
  const groups = useMemo(() => clusters(routes || []), [routes]);
  const [selected, setSelected] = useState(0);
  const mapNode = useRef(null), mapRef = useRef(null), layerRef = useRef(null);
  const group = groups[Math.min(selected, Math.max(0, groups.length - 1))];

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = L.map(mapNode.current, { zoomControl: true, attributionControl: true, preferCanvas: true });
    L.tileLayer("/api/map-tiles-v2/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors", className: "pulse-map-tiles" }).addTo(map);
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
    for (const bundle of bundles(group.routes)) {
      const latlngs = bundle.points.map((p) => [p.lat, p.lon]);
      if (latlngs.length < 2) continue;
      const weight = Math.min(6, 3 + Math.log2(bundle.runs.length));
      const glow = L.polyline(latlngs, { color: "#0ea5e9", weight: weight + 6, opacity: .22, interactive: false }).addTo(layer);
      const line = L.polyline(latlngs, { color: "#38bdf8", weight, opacity: .82, lineCap: "round" }).addTo(layer);
      const details = popup(bundle);
      line.bindTooltip(details, { sticky: true, direction: "top", className: "pulse-route-tooltip" });
      line.bindPopup(details, { className: "pulse-route-popup", maxWidth: 290 });
      line.on("mouseover", () => line.setStyle({ color: "#e0f7ff", weight: weight + 2, opacity: 1 }));
      line.on("mouseout", () => line.setStyle({ color: "#38bdf8", weight, opacity: .82 }));
      glow.bringToBack();
    }
    if (layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), { padding: [26, 26], maxZoom: 15 });
  }, [group]);

  if (!group) return <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-line text-xs text-faint">No valid GPS points</div>;
  return <div className="space-y-2">
    {showAreas && groups.length > 1 && <div className="flex gap-1.5 overflow-x-auto pb-1">{groups.map((area, i) => <button key={i} onClick={() => setSelected(i)} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${i === selected ? "border-cardio/60 bg-cardio/15 text-cardio" : "border-line text-muted"}`}><MapPin size={10} className="mr-1 inline" />Area {i + 1} · {area.routes.length}</button>)}</div>}
    <div className="relative overflow-hidden rounded-xl border border-cardio/25 bg-[#071019]" style={{ height }}>
      <div ref={mapNode} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute bottom-2 left-3 z-[500] rounded-full border border-white/10 bg-black/60 px-2 py-1 font-mono text-xs text-white/70">HOVER OR TAP A ROUTE · AREA {selected + 1}</div>
    </div>
  </div>;
}
