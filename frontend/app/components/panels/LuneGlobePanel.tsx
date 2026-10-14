import { useStore, type ReadableStore } from "../../lib/store";

type LuneGlobePanelProps = {
  /** Positioned by the panel dock instead of itself. */
  docked?: boolean;
  searchSuggestions: SearchSuggestion[];
  activePanel: "search" | "filter";
  onOpenSearchPanel: () => void;
  onOpenFilterPanel: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchLoading: boolean;
  onSearchSelect: (sat: SearchSuggestion) => void;
  satType: string;
  satCompany: string;
  satTypes: string[];
  satTypeDescriptions: Record<string, string>;
  companyOptions: Record<string, string[]>;
  companyDescriptions: Record<string, string>;
  onSatTypeChange: (value: string) => void;
  onSatCompanyChange: (value: string) => void;
  /** Satellites drawn and last update time; read from a store so only this panel re-renders. */
  statsStore: ReadableStore<{ count: number; lastUpdated: string | null }>;
  satCount: number;
  dataSource: string | null;
  tleUpdatedAt: string | null;
  loading: boolean;
};

type SearchSuggestion = {
  satelliteId: number;
  name: string;
};

export default function LuneGlobePanel({
  docked = false,
  activePanel,
  onOpenSearchPanel,
  onOpenFilterPanel,
  searchQuery,
  onSearchQueryChange,
  searchLoading,
  searchSuggestions,
  onSearchSelect,
  satType,
  satCompany,
  satTypes,
  satTypeDescriptions,
  companyOptions,
  companyDescriptions,
  onSatTypeChange,
  onSatCompanyChange,
  statsStore,
  satCount,
  dataSource,
  tleUpdatedAt,
  loading,
}: LuneGlobePanelProps) {
  return (
    <div
      style={{
        ...(docked ? {} : { position: "absolute" as const, top: 12, left: 12, zIndex: 11 }),
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.4,
        maxWidth: 360,
        pointerEvents: "auto",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Lune Globe</div>

      <div style={{ marginBottom: 4 }}>
        <div
          onClick={onOpenSearchPanel}
          style={{
            cursor: "pointer",
            padding: "6px 8px",
            borderRadius: 6,
            background: activePanel === "search" ? "rgba(255,255,255,0.1)" : "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            userSelect: "none",
          }}
        >
          <span style={{ fontWeight: 600 }}>Search A Satellite</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{activePanel === "search" ? "▾" : "▸"}</span>
        </div>
        {activePanel === "search" && (
          <div style={{ padding: "8px 4px 4px" }}>
            <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontSize: 11 }}>
              Search for a satellite, given their name
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="e.g. INTELSAT, ISS..."
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "#181818",
                  color: "#fff",
                  fontSize: 12,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {searchLoading && (
                <div style={{ marginTop: 4, color: "#4fc3f7", fontSize: 11 }}>Searching...</div>
              )}
              {searchSuggestions.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    maxHeight: 180,
                    overflowY: "auto",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(20,20,30,0.95)",
                  }}
                >
                  {searchSuggestions.map((s) => (
                    <div
                      key={s.satelliteId}
                      onClick={() => onSearchSelect(s)}
                      style={{
                        padding: "5px 8px",
                        cursor: "pointer",
                        fontSize: 11,
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div
          onClick={onOpenFilterPanel}
          style={{
            cursor: "pointer",
            padding: "6px 8px",
            borderRadius: 6,
            background: activePanel === "filter" ? "rgba(255,255,255,0.1)" : "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            userSelect: "none",
          }}
        >
          <span style={{ fontWeight: 600 }}>Filter By Type</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{activePanel === "filter" ? "▾" : "▸"}</span>
        </div>
        {activePanel === "filter" && (
          <div style={{ padding: "8px 4px 4px" }}>
            <div style={{ marginBottom: 6 }}>
              <label htmlFor="sat-type-select" style={{ marginRight: 8 }}>Type:</label>
              <select
                id="sat-type-select"
                value={satType}
                onChange={(e) => onSatTypeChange(e.target.value)}
                style={{ fontSize: 13, padding: "2px 8px", borderRadius: 6, background: "#222", color: "#fff" }}
              >
                {satTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            {satTypeDescriptions[satType] && (
              <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.6)", fontStyle: "italic", lineHeight: 1.4, fontSize: 11 }}>
                {satTypeDescriptions[satType]}
              </div>
            )}
            <div style={{ marginTop: 8, marginBottom: 6 }}>
              <label htmlFor="sat-company-select" style={{ marginRight: 8 }}>Company:</label>
              <select
                id="sat-company-select"
                value={satCompany}
                onChange={(e) => onSatCompanyChange(e.target.value)}
                style={{ fontSize: 13, padding: "2px 8px", borderRadius: 6, background: "#222", color: "#fff" }}
              >
                {(companyOptions[satType] ?? ["All"]).map((company) => (
                  <option key={company} value={company}>{company}</option>
                ))}
              </select>
            </div>
            {companyDescriptions[satCompany] && (
              <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.6)", fontStyle: "italic", lineHeight: 1.4, fontSize: 11 }}>
                {companyDescriptions[satCompany]}
              </div>
            )}
          </div>
        )}
      </div>

      <CatalogCounts statsStore={statsStore} satCount={satCount} />
      {dataSource && (
        <div style={{ marginTop: 2, fontSize: 11, color: dataSource.includes("tle-api") ? "#ffa726" : "#66bb6a" }}>
          Source: {dataSource.split("+").map((s) => (s === "celestrak" ? "CelesTrak" : "TLE API")).join(" + ")}
          {dataSource.includes("tle-api") ? " (fallback)" : ""}
          {tleUpdatedAt ? ` · TLEs ${formatAge(tleUpdatedAt)}` : ""}
        </div>
      )}
      {loading && (
        <div style={{ marginTop: 6, color: "#4fc3f7" }}>
          Loading satellite TLEs...
        </div>
      )}
      <div style={{ marginTop: 6, color: "rgba(255,255,255,0.75)" }}>
        Tip: click a satellite dot to show its orbit path.
      </div>
    </div>
  );
}

function formatAge(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just updated";
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `updated ${hours} h ago`;
  return `updated ${Math.round(hours / 24)} days ago`;
}

/** "Satellites: n / total" and the last update time, re-rendered on their own every few seconds. */
function CatalogCounts({ statsStore, satCount }: { statsStore: ReadableStore<{ count: number; lastUpdated: string | null }>; satCount: number }) {
  const { count, lastUpdated } = useStore(statsStore);
  return (
    <>
      <div>Satellites: {count}{satCount > 0 && count < satCount ? ` / ${satCount}` : ""}</div>
      <div>Update: {lastUpdated ?? "--"}</div>
    </>
  );
}
