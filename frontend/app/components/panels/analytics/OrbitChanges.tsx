import { useState } from "react";
import { fetchOrbitChanges, type OrbitChange, type OrbitChangesResponse } from "../../../lib/api";
import AltitudeHistory from "./AltitudeHistory";
import { MUTED, TEXT, buttonStyle, chipStyle, errorStyle, hintStyle, linkStyle } from "./ui";

export type ChangeKind = "raise" | "lower" | "plane_change" | "decaying";

const KINDS: { id: ChangeKind; label: string; color: string; title: string }[] = [
  { id: "raise", label: "Raised", color: "#69f0ae", title: "Altitude went up between TLEs: only an engine can do that" },
  { id: "lower", label: "Lowered", color: "#ffd54f", title: "Dropped faster than drag explains: a deliberate lowering or deorbit burn" },
  { id: "plane_change", label: "Plane change", color: "#ba68c8", title: "Inclination changed: a plane-change manoeuvre" },
  { id: "decaying", label: "Decaying", color: "#ff8a65", title: "Low and losing altitude: heading for re-entry" },
];

type OrbitChangesProps = {
  /** The satellites drawn on the globe right now. */
  loadedIds: number[];
  focusedKind: ChangeKind | null;
  /** Focus a kind of change on the globe (its satellites stay bright), or null to stop. */
  onFocusKind: (kind: ChangeKind | null, ids: number[]) => void;
  onShow: (satelliteId: number) => void;
  onHover: (satelliteId: number | null) => void;
};

/**
 * Finds manoeuvres and decay by comparing each loaded satellite with its earlier TLEs, which the backend
 * records on every catalog refresh.
 */
export default function OrbitChanges({ loadedIds, focusedKind, onFocusKind, onShow, onHover }: OrbitChangesProps) {
  const [result, setResult] = useState<OrbitChangesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const scan = async () => {
    setBusy(true);
    setError(null);
    onFocusKind(null, []);
    try {
      setResult(await fetchOrbitChanges(loadedIds));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  };

  const byKind = new Map<ChangeKind, OrbitChange[]>(KINDS.map((k) => [k.id, []]));
  for (const s of result?.satellites ?? []) {
    if (s.decaying) byKind.get("decaying")?.push(s);
    const latest = s.events[s.events.length - 1];
    if (latest) byKind.get(latest.type)?.push(s);
  }
  const listed = focusedKind ? byKind.get(focusedKind) ?? [] : [];

  return (
    <div>
      <p style={{ ...hintStyle, marginBottom: 10 }}>
        Compares each satellite with its earlier TLEs to spot engine burns (orbit raised, lowered or tilted) and
        satellites decaying towards re-entry.
      </p>
      <button type="button" onClick={scan} disabled={busy || loadedIds.length === 0} style={buttonStyle(!busy && loadedIds.length > 0)}>
        {busy ? "Scanning…" : `Scan ${loadedIds.length.toLocaleString()} loaded satellites`}
      </button>
      {error && <div style={{ ...errorStyle, marginTop: 8 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 10, fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
          {result.withHistory === 0 ? (
            <div>
              No history to compare yet.{" "}
              {result.historySince
                ? `The backend has been recording TLEs since ${formatDate(result.historySince)}`
                : "The backend starts recording TLEs on its next catalog refresh"}
              ; every refresh (2 h from CelesTrak, 6 h from the fallback) adds one per satellite whose TLE changed. Check
              back once a few have come in.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                {result.withHistory.toLocaleString()} of {result.requested.toLocaleString()} satellites have earlier TLEs to compare
                {result.historySince ? ` (recording since ${formatDate(result.historySince)})` : ""}.{" "}
                {result.satellites.length === 0 ? "No changes found." : "Click a kind to focus it on the globe."}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {KINDS.map((k) => {
                  const sats = byKind.get(k.id) ?? [];
                  const active = focusedKind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      title={k.title}
                      disabled={sats.length === 0}
                      onClick={() => onFocusKind(active ? null : k.id, sats.map((s) => s.satelliteId))}
                      style={{ ...chipStyle(active, sats.length === 0), opacity: sats.length === 0 ? 0.45 : 1, display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.color }} />
                      {k.label} {sats.length.toLocaleString()}
                    </button>
                  );
                })}
              </div>
              {listed.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column" }}>
                  {listed.slice(0, 100).map((s) => (
                    <div
                      key={s.satelliteId}
                      onMouseEnter={() => onHover(s.satelliteId)}
                      onMouseLeave={() => onHover(null)}
                      style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === s.satelliteId ? null : s.satelliteId)}
                          aria-expanded={expanded === s.satelliteId}
                          style={{ ...linkStyle, color: TEXT, fontSize: 10 }}
                          title="Altitude over time"
                        >
                          {expanded === s.satelliteId ? "▾" : "▸"} {s.name}
                        </button>
                        <span style={{ display: "block" }}>{describeChange(s, focusedKind)}</span>
                        {expanded === s.satelliteId && <AltitudeHistory ids={[s.satelliteId]} />}
                      </span>
                      <button type="button" onClick={() => onShow(s.satelliteId)} style={linkStyle}>show</button>
                    </div>
                  ))}
                  {listed.length > 100 && <div style={{ marginTop: 4 }}>+ {(listed.length - 100).toLocaleString()} more</div>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function describeChange(s: OrbitChange, kind: ChangeKind | null): string {
  if (kind === "decaying") {
    const rate = s.altitudeRateKmPerDay !== null ? `${Math.abs(s.altitudeRateKmPerDay).toFixed(2)} km/day` : "";
    const eta = s.daysToReentry !== null ? ` · re-entry in ≲${Math.round(s.daysToReentry)} days` : "";
    return `${Math.round(s.latestAltitudeKm)} km, falling ${rate}${eta}`;
  }
  const e = s.events[s.events.length - 1];
  if (!e) return "";
  const when = formatDate(e.to);
  if (e.type === "plane_change") return `inclination ${signed(e.deltaInclinationDeg, 3)}° · ${when}`;
  return `${signed(e.deltaAltitudeKm, 1)} km to ${Math.round(s.latestAltitudeKm)} km · ${when}`;
}

function signed(v: number, digits: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
