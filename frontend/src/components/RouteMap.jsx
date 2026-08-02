import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api";
import { COLORS } from "../lib/format";

// Raw Leaflet (not react-leaflet) — one extra dependency instead of two, and this
// is a single imperative map, no need for a React binding layer.
export default function RouteMap({ activityId }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const [state, setState] = useState("loading"); // loading | ok | empty | error

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api.activityRoute(activityId)
      .then(({ points }) => {
        if (cancelled || !points?.length || !elRef.current) { setState("empty"); return; }

        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
        const map = L.map(elRef.current, { zoomControl: true, attributionControl: true });
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        const latlngs = points.map((p) => [p.lat, p.lon]);
        const line = L.polyline(latlngs, { color: COLORS.cardio, weight: 4, opacity: 0.9 }).addTo(map);
        L.circleMarker(latlngs[0], { radius: 6, color: COLORS.recovery, fillColor: COLORS.recovery, fillOpacity: 1 })
          .addTo(map).bindTooltip("Start");
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: COLORS.effort, fillColor: COLORS.effort, fillOpacity: 1 })
          .addTo(map).bindTooltip("Finish");
        map.fitBounds(line.getBounds(), { padding: [16, 16] });
        setState("ok");
      })
      .catch(() => { if (!cancelled) setState("empty"); });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [activityId]);

  if (state === "empty") return null; // no GPS data — just omit the map, not an error worth surfacing

  return (
    <div>
      <div className="mb-2 text-[10.5px] uppercase tracking-wider text-faint">Route</div>
      <div className="relative h-56 overflow-hidden rounded-xl border border-line">
        {state === "loading" && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-panel2/60">
            <span className="font-mono text-xs text-muted">loading route…</span>
          </div>
        )}
        <div ref={elRef} className="h-full w-full bg-panel2" />
      </div>
    </div>
  );
}
