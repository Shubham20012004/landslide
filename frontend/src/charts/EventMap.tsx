import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { MapPoint } from "../types";
import { humanize } from "../utils/format";

/** Recorded historical events (not sensor locations). Radius grows with recorded fatalities. */
export default function EventMap({ points, height = 460 }: { points: MapPoint[]; height?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line [&_.leaflet-tile-pane]:[filter:invert(1)_hue-rotate(180deg)_brightness(0.85)_contrast(0.9)]" style={{ height }}>
      <MapContainer center={[20, 30]} zoom={2} minZoom={2} worldCopyJump preferCanvas style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {points.map((p, i) => {
          const f = p.fatalities ?? 0;
          return (
            <CircleMarker key={i} center={[p.lat, p.lon]} radius={f > 0 ? Math.min(3 + Math.sqrt(f), 14) : 2.5}
              pathOptions={{ color: f > 0 ? "#ec835a" : "#3987e5", weight: 0.6, fillOpacity: f > 0 ? 0.55 : 0.45, fillColor: f > 0 ? "#ec835a" : "#3987e5" }}>
              <Popup>
                <div className="space-y-0.5 text-xs">
                  <div className="font-semibold">{p.title || "Untitled event"}</div>
                  <div>{p.date ?? "date unknown"} · {p.country ?? "country not recorded"}</div>
                  <div>Trigger: {humanize(p.trigger)} · Size: {humanize(p.size)}</div>
                  <div>Recorded fatalities: {p.fatalities ?? "not recorded"}</div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
