import { clusterLabelName, type ClusterAlgorithm } from "./clusterLabels";

/** One clustering run: every satellite sent to the model, the label it got back, and where it was. */
export type ClusterRun = {
  algorithm: ClusterAlgorithm;
  paramsLine: string;
  /** Column names of the features the model saw, in order (see lib/clusterFeatures). */
  featureNames: string[];
  /** The (simulated) moment whose positions or orbits were clustered. */
  computedAtMs: number;
  rows: {
    satelliteId: number;
    name: string;
    label: number;
    features: number[];
    lat: number;
    lng: number;
    alt: number;
  }[];
};

export function clusterRunToCsv(run: ClusterRun): string {
  const at = new Date(run.computedAtMs).toISOString();
  const header = [
    "norad_id",
    "name",
    "label",
    "group",
    ...run.featureNames.map((f) => `feature_${f}`),
    "latitude_deg",
    "longitude_deg",
    "altitude_km",
    "algorithm",
    "params",
    "computed_at_utc",
  ];
  const lines = [header.join(",")];
  for (const r of run.rows) {
    lines.push(
      [
        r.satelliteId,
        csvField(r.name),
        r.label,
        csvField(clusterLabelName(run.algorithm, r.label)),
        ...r.features.map((v) => String(Number(v.toPrecision(8)))),
        r.lat.toFixed(5),
        r.lng.toFixed(5),
        r.alt.toFixed(3),
        run.algorithm,
        csvField(run.paramsLine),
        at,
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

/** Quote a value if it contains a comma, quote or line break (RFC 4180). */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Earth Imaging-Jilin-1" → "earth-imaging-jilin-1" */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** 2026-10-14T15:16:26Z → "20261014-151626" */
export function fileTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}
