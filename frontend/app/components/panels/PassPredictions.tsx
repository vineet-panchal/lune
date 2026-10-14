import { useMemo, useState, type CSSProperties } from "react";
import type * as satellite from "satellite.js";
import { compassPoint, predictPasses, type Observer, type PassVisibility } from "../../lib/passes";

type PassPredictionsProps = {
  satrec: satellite.SatRec;
  /** Predictions start from the globe's (simulated) current time. */
  fromMs: number;
  observer: Observer | null;
  onObserverChange: (observer: Observer | null) => void;
  /** Jump the time controls to this moment. */
  onShowPass: (riseMs: number) => void;
};

/** Recompute at most every 10 simulated minutes; a 3-day search costs ~30 ms. */
const RECOMPUTE_BUCKET_MS = 10 * 60_000;

const VISIBILITY_STYLE: Record<PassVisibility, { label: string; color: string; title: string }> = {
  visible: { label: "Visible", color: "#66bb6a", title: "Sunlit against a dark sky: look for a moving star" },
  daylight: { label: "Daylight", color: "rgba(255,255,255,0.45)", title: "Overhead during daytime: too bright to see" },
  eclipsed: { label: "In shadow", color: "rgba(255,255,255,0.45)", title: "Your sky is dark but the satellite is in Earth's shadow" },
};

export default function PassPredictions({ satrec, fromMs, observer, onObserverChange, onShowPass }: PassPredictionsProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>When can I see it?</div>
      {!observer || editing ? (
        <LocationForm
          current={observer}
          onSave={(o) => {
            onObserverChange(o);
            setEditing(false);
          }}
          onCancel={observer ? () => setEditing(false) : undefined}
        />
      ) : (
        <>
          <div style={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>
            From {formatLatLng(observer)} ·{" "}
            <span style={link} onClick={() => setEditing(true)}>change</span>
          </div>
          <PassList satrec={satrec} fromMs={fromMs} observer={observer} onShowPass={onShowPass} />
        </>
      )}
    </div>
  );
}

function PassList({ satrec, fromMs, observer, onShowPass }: { satrec: satellite.SatRec; fromMs: number; observer: Observer; onShowPass: (ms: number) => void }) {
  const bucket = Math.floor(fromMs / RECOMPUTE_BUCKET_MS) * RECOMPUTE_BUCKET_MS;
  const prediction = useMemo(
    () => predictPasses(satrec, observer, bucket, { days: 3, maxPasses: 5 }),
    [satrec, observer, bucket]
  );

  if (prediction.kind === "stationary") {
    return (
      <div style={{ color: "rgba(255,255,255,0.75)" }}>
        {prediction.elevationDeg > 0
          ? `Stays put in your sky: ${prediction.elevationDeg.toFixed(0)}° up, toward the ${compassPoint(prediction.azimuthDeg)} (geosynchronous).`
          : "Never rises above your horizon (geosynchronous, on the other side of the Earth)."}
      </div>
    );
  }
  const upcoming = prediction.passes.filter((p) => p.set.getTime() > fromMs);
  if (upcoming.length === 0) {
    return <div style={{ color: "rgba(255,255,255,0.6)" }}>No passes higher than 10° in the next 3 days.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {upcoming.map((p) => {
        const vis = VISIBILITY_STYLE[p.visibility];
        const inProgress = p.rise.getTime() <= fromMs;
        const minutes = Math.max(1, Math.round((p.set.getTime() - p.rise.getTime()) / 60_000));
        return (
          <div key={p.rise.getTime()} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, color: "rgba(255,255,255,0.9)" }}>
              {inProgress ? "Now" : formatPassTime(p.rise)} · ↑{p.maxElevationDeg.toFixed(0)}° ·{" "}
              {compassPoint(p.riseAzimuthDeg)}→{compassPoint(p.setAzimuthDeg)} · {minutes} min
            </span>
            <span title={vis.title} style={{ color: vis.color, fontSize: 10, whiteSpace: "nowrap" }}>{vis.label}</span>
            <span
              style={link}
              onClick={() => onShowPass(p.rise.getTime())}
              title="Jump the time controls to this pass"
            >
              show
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LocationForm({ current, onSave, onCancel }: { current: Observer | null; onSave: (o: Observer) => void; onCancel?: () => void }) {
  const [lat, setLat] = useState(current ? String(current.latDeg) : "");
  const [lng, setLng] = useState(current ? String(current.lngDeg) : "");
  const [status, setStatus] = useState<string | null>(null);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStatus("Location isn't available in this browser; enter coordinates instead.");
      return;
    }
    setStatus("Asking your browser for your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => onSave({ latDeg: round(pos.coords.latitude), lngDeg: round(pos.coords.longitude), heightKm: (pos.coords.altitude ?? 0) / 1000 }),
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "Permission denied; enter coordinates instead." : "Couldn't get your location; enter coordinates instead."),
      { timeout: 10_000, maximumAge: 3_600_000 }
    );
  };

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const valid = lat.trim() !== "" && lng.trim() !== "" && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div>
        <span style={link} onClick={useMyLocation}>Use my location</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}> or enter it:</span>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat 43.65" aria-label="Latitude" inputMode="decimal" style={input} />
        <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="lng -79.38" aria-label="Longitude" inputMode="decimal" style={input} />
        <span
          style={{ ...link, opacity: valid ? 1 : 0.4, cursor: valid ? "pointer" : "default" }}
          onClick={() => valid && onSave({ latDeg: latNum, lngDeg: lngNum })}
        >
          save
        </span>
        {onCancel && <span style={link} onClick={onCancel}>cancel</span>}
      </div>
      {status && <div style={{ color: "rgba(255,255,255,0.5)" }}>{status}</div>}
      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Saved only in this browser.</div>
    </div>
  );
}

const link: CSSProperties = { color: "#4fc3f7", cursor: "pointer", whiteSpace: "nowrap" };
const input: CSSProperties = {
  width: 78,
  padding: "1px 4px",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  font: "inherit",
  fontSize: 11,
};

function round(n: number): number {
  return Math.round(n * 1000) / 1000; // ~100 m: plenty for pass predictions, less identifying
}

function formatLatLng(o: Observer): string {
  return `${Math.abs(o.latDeg).toFixed(2)}°${o.latDeg >= 0 ? "N" : "S"}, ${Math.abs(o.lngDeg).toFixed(2)}°${o.lngDeg >= 0 ? "E" : "W"}`;
}

function formatPassTime(d: Date): string {
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
