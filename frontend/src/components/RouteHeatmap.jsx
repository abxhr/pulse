import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Map as MapIcon, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { COLORS } from "../lib/format";
import { Panel } from "./primitives";

export default function RouteHeatmap() {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = () => api.routeHeatmap().then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!data?.routes?.length || !elRef.current) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true });
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const allBounds = [];
    for (const r of data.routes) {
      if (!r.points?.length) continue;
      const latlngs = r.points.map((p) => [p.lat, p.lon]);
      // Low-opacity overlapping lines are the "heat" — routes you repeat glow
      // brighter where they overlap, one-off routes stay faint.
      L.polyline(latlngs, { color: COLORS.cardio, weight: 2.5, opacity: 0.18 }).addTo(map);
      allBounds.push(...latlngs);
    }
    if (allBounds.length) map.fitBounds(allBounds, { padding: [20, 20] });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [data]);

  async function syncMore() {
    setSyncing(true);
    try {
      let done = false;
      while (!done) {
        const res = await api.syncRouteHeatmap(8);
        done = res.done;
      }
      await load();
    } finally {
      setSyncing(false);
    }
  }

  if (!data) return null;
  const missing = (data.total_runs || 0) - data.cached_count;

  return (
    <Panel accent={COLORS.cardio} title="Route heatmap" sub={`${data.cached_count} of ${data.total_runs} runs mapped`}
      right={missing > 0 && (
        <button onClick={syncMore} disabled={syncing}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[11px] text-muted transition hover:border-cardio/40 disabled:opacity-50">
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "Loading…" : `Load ${missing} more`}
        </button>
      )}>
      {data.routes.length ? (
        <div className="h-72 overflow-hidden rounded-xl border border-line">
          <div ref={elRef} className="h-full w-full bg-panel2" />
        </div>
      ) : (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center">
          <MapIcon size={20} className="text-faint" />
          <p className="text-xs text-faint">No routes mapped yet — click "Load more" to fetch GPS tracks.</p>
        </div>
      )}
    </Panel>
  );
}
