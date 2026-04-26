type LuneGlobePanelProps = {
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
  satellitesLength: number;
  satCount: number;
  lastUpdated: string | null;
  dataSource: string | null;
  loading: boolean;
};

type SearchSuggestion = {
  satelliteId: number;
  name: string;
};

export default function LuneGlobePanel({
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
  satellitesLength,
  satCount,
  lastUpdated,
  dataSource,
  loading,
}: LuneGlobePanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.4,
        maxWidth: 360,
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

      <div>Satellites: {satellitesLength}{satCount > 0 && satellitesLength < satCount ? ` / ${satCount}` : ""}</div>
      <div>Update: {lastUpdated ?? "--"}</div>
      {dataSource && (
        <div style={{ marginTop: 2, fontSize: 11, color: dataSource === "celestrak" ? "#66bb6a" : "#ffa726" }}>
          Source: {dataSource === "celestrak" ? "CelesTrak" : "TLE API"}{dataSource !== "celestrak" ? " (fallback)" : ""}
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
