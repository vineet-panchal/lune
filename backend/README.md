# Lune Backend

Backend for **Lune** — satellite and space-object tracking (AirLoom-style, but for satellites and future missions).

## Run

```bash
./mvnw spring-boot:run
```

Defaults: `http://localhost:8080`. CORS is allowed for `http://localhost:3000` and `http://127.0.0.1:3000` for the Next.js frontend.

## Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `lune.tle-api.base-url` | `https://tle.ivanstanojevic.me` | TLE API base URL for catalog and propagation |

## API Overview

### Satellites (TLE-based)

- **`GET /api/satellites`** — Paginated list of satellites (from TLE catalog).  
  Query: `page` (default 1), `pageSize` (default 20, max 50), optional `search` (filter by name, e.g. `ISS`, `NOAA`, `Starlink`), optional `sort` (e.g. `popularity`, `name`), optional `group=popular` (curated list only, no external catalog call — fastest).

- **`GET /api/satellites/{satelliteId}`** — Single satellite TLE by NORAD ID.

- **`GET /api/satellites/{satelliteId}/position?datetime=...`** — Position at a given UTC time.  
  Returns ECI (x,y,z) in km, geodetic (lat, lon, altitude km), and velocity. Omit `datetime` for “now”.

- **`GET /api/satellites/{satelliteId}/trail?datetime=...&trailKm=30`** — Position plus trail (past/future) for orbit line.  
  `trailKm`: distance each direction in km (default 30, clamped 5–50). Fewer points for smaller trail. Omit `datetime` for “now”.

- **`GET /api/satellites/positions?ids=25544,49260,...`** — Batch current positions for given NORAD IDs (comma-separated, max 30).  
  Optional `datetime` for a specific UTC time.

### Future launches

- **`GET /api/launches`** — Upcoming missions (stub: Artemis III, Starship, etc.).  
  Query: `limit` (default 20, max 50).

- **`GET /api/launches/{launchId}/trajectory`** — Simplified trajectory (e.g. launch site → Moon) for a mission. Stub for now.

### Trajectory (Earth → Mars, etc.)

- **`POST /api/trajectory/plan`** — Plan a path from Earth coordinates to a destination.  
  Body: `{ "originLat": 28.5, "originLon": -80.6, "destination": "mars", "launchDate": "2026-01-15" }`.  
  Returns a stub path and approximate transfer days; can be refined later with proper ephemeris.

## Data sources

- **Satellite catalog & propagation**: [TLE API](https://tle.ivanstanojevic.me/) (CelesTrak–based).
- **Future launches**: Stub data; can be wired to [Launch Library 2](https://ll.thespacedevs.com/) or NASA later.
- **Earth–Mars trajectory**: Stub; production would use SPICE or similar.

## Tech

- Java 17, Spring Boot 4, Spring Web (MVC), WebFlux (client), JPA, PostgreSQL (optional for now).
