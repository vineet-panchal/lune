# Lune - Satellite Tracking & Orbital Intelligence Platform

**Lune** is a full-stack application for real-time satellite tracking, orbital analysis, and space mission visualization. Track active satellites, visualize orbits in real-time, analyze orbital clusters, and plan future trajectories—all in an interactive 3D interface.

## 🚀 Features

### Satellite Tracking
- **Real-time Position Updates**: Track thousands of satellites with live position calculations using SGP4 propagation
- **Comprehensive Catalog**: Access to a massive TLE (Two-Line Element) database covering active satellites, ISS, Hubble, Starlink, GPS, GLONASS, and more
- **Curated Lists**: Browse popular satellites, constellation groups, and custom searches
- **Orbital Trails**: Visualize satellite paths with configurable trail lengths (5-50 km)
- **Position History**: Query satellite positions at any point in time

### Interactive 3D Visualization
- **Globe.gl Integration**: WebGL-based interactive globe with real-time satellite rendering
- **Multiple Map Styles**: Default, 4K detail, black, and white map themes
- **Point-of-View Control**: Camera-following satellite tracks and interactive camera positioning
- **Cluster Visualization**: Visual grouping of satellites with color-coded orbital analysis

### Orbital Analytics
- **Clustering Algorithms**: Analyze satellite distributions using KMeans, DBSCAN
- **Anomaly Detection**: Identify unusual orbital patterns with Isolation Forest
- **Orbital Parameters**: Group satellites by altitude, inclination, mean motion, and more
- **Data Insights**: Export and analyze orbital characteristics

### Mission Planning (Coming Soon)
- **Launch Trajectories**: Plan future missions and visualize launch paths
- **Destination Planning**: Earth-to-Mars and other inter-planetary trajectory planning
- **Time-based Propagation**: Calculate mission timelines and ephemeris data

## 🏗️ Architecture

```
lune/
├── backend/              # Spring Boot REST API
│   ├── satellite/        # TLE catalog, SGP4 propagation, position calculations
│   ├── analytics/        # Clustering service integration
│   ├── launch/           # Launch planning and trajectory management
│   └── config/           # CORS, WebConfig
├── frontend/             # Next.js + React UI
│   ├── components/       # Globe, panels, controls
│   ├── pages/            # Satellite tracker, orbital intelligence
│   └── lib/              # API client, utilities
└── analytics-service/    # FastAPI ML service
    └── main.py          # KMeans, DBSCAN, Isolation Forest
```

## 🛠️ Tech Stack

### Backend
- **Java 17** + **Spring Boot 4**
- **WebFlux** for async HTTP client
- **SGP4 Propagator** for orbital mechanics
- **RESTful API** with CORS support for frontend

### Frontend
- **Next.js 16** (React 19)
- **TypeScript 5**
- **Three.js** + **Globe.gl** for 3D visualization
- **satellite.js** for client-side TLE parsing
- **Tailwind CSS** for styling
- **React Icons** for UI elements

### Analytics
- **Python 3.10+** with **FastAPI**
- **scikit-learn** for ML algorithms
- **NumPy** for numerical operations
- **Pydantic** for data validation

### Data Sources
- **TLE API**: [tle.ivanstanojevic.me](https://tle.ivanstanojevic.me/) - Real-time satellite catalog
- **CelesTrak Groups**: GPS, GLONASS, Galileo, Starlink, NOAA, etc.
- **Custom Databases**: ISS, Hubble, Chinese Space Station, and more

## 📋 Quick Start

### Backend (Java)

```bash
cd backend
./mvnw spring-boot:run
```

Runs on `http://localhost:8080` with CORS enabled for `http://localhost:3000`

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:3000`

### Analytics Service (Python)

```bash
cd analytics-service
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Runs on `http://localhost:8001`

## 🌐 API Endpoints

### Satellites

```bash
# List satellites (paginated, with search & filters)
GET /api/satellites?page=1&pageSize=20&search=ISS&group=popular

# Get specific satellite TLE
GET /api/satellites/25544

# Get current position
GET /api/satellites/25544/position

# Get position with orbital trail
GET /api/satellites/25544/trail?trailKm=30

# Batch positions for multiple satellites
GET /api/satellites/positions?ids=25544,49260,48274
```

### Analytics

```bash
# Cluster satellites by orbital parameters
POST /api/analytics/cluster
{
  "algorithm": "kmeans",
  "k": 5,
  "points": [
    {
      "satelliteId": 25544,
      "name": "ISS",
      "altitudeKm": 408,
      "inclinationDeg": 51.6,
      "meanMotionRpd": 15.54
    }
  ]
}
```

### Launches

```bash
# Upcoming missions
GET /api/launches?limit=20

# Mission trajectory
GET /api/launches/artemis-3/trajectory
```

## 📊 Code Examples

### Real-time Satellite Position (Backend)

```java
@GetMapping("/{satelliteId}/position")
public ResponseEntity<SatellitePositionDto> getPosition(
        @PathVariable int satelliteId,
        @RequestParam(required = false) ZonedDateTime datetime) {
    Instant instant = datetime != null 
        ? datetime.withZoneSameInstant(ZoneOffset.UTC).toInstant() 
        : Instant.now();
    Optional<SatellitePositionDto> opt = satelliteService.getPosition(satelliteId, instant);
    return opt.map(ResponseEntity::ok)
              .orElseGet(() -> ResponseEntity.notFound().build());
}
```

The `SatelliteService` uses SGP4 propagator to calculate satellite positions:

```java
private final Sgp4Propagator sgp4Propagator;

// Calculate propagation at a given time
PropagationResultDto result = sgp4Propagator.propagate(tle, instant);
// Returns ECI coordinates (x,y,z in km), velocity, and geodetic coordinates
```

### Interactive Globe with Real-time Updates (Frontend)

```typescript
// Fetch satellite positions and update globe
const fetchAndUpdateSatellites = async () => {
  const response = await fetchSatellites(page, pageSize, search);
  const satellites: Sat[] = response.items.map(sat => ({
    satelliteId: sat.satelliteId,
    name: sat.name,
    latitude: sat.latitude,
    longitude: sat.longitude,
    altitudeKm: sat.altitudeKm,
    type: sat.type
  }));
  
  // Update globe points
  globeRef.current
    .pointsData(satellites)
    .pointLat(d => d.latitude)
    .pointLng(d => d.longitude)
    .pointAltitude(d => d.altitudeKm / EARTH_RADIUS_KM)
    .pointColor(d => getSatelliteColor(d.type))
    .pointRadius(2);
};
```

### Orbital Clustering with Machine Learning (Analytics)

```python
@app.post("/cluster")
async def cluster_satellites(request: ClusterRequest):
    # Prepare feature matrix: [altitude, inclination, mean_motion]
    X = np.array([
        [p.altitude_km, p.inclination_deg, p.mean_motion_rpd]
        for p in request.points
    ])
    
    # Normalize features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Apply clustering algorithm
    if request.algorithm == "kmeans":
        model = KMeans(n_clusters=request.k, random_state=42)
        labels = model.fit_predict(X_scaled)
    elif request.algorithm == "dbscan":
        model = DBSCAN(eps=request.dbscan_eps, min_samples=request.dbscan_min_samples)
        labels = model.fit_predict(X_scaled)
    
    return {
        "clusters": labels,
        "algorithm": request.algorithm,
        "point_count": len(request.points)
    }
```

## 📁 Project Structure

### Backend Services

**SatelliteService.java** (900+ lines)
- TLE caching and fetching from multiple sources
- SGP4 propagation for position calculations
- Trail generation with configurable point counts
- Celestrak group integration (25+ satellite constellations)
- Search and filtering with popularity ranking

**AnalyticsService.java**
- Integration with FastAPI ML service
- Request/response mapping for clustering
- Algorithm selection and parameter validation

**LaunchService.java**
- Future mission data management
- Trajectory planning stubs
- Launch window calculations

### Frontend Components

**GlobeView.tsx** (1000+ lines)
- Core satellite tracking interface
- Real-time position updates with WebGL rendering
- Multiple visualization modes
- Interactive camera controls

**OrbitalAnalyticsPanel.tsx**
- ML algorithm selector (KMeans, DBSCAN, Isolation Forest)
- Cluster visualization and analysis
- Parameter configuration UI

**SelectedSatellitesPanel.tsx**
- Favorites/watchlist management
- Detailed satellite information
- Historical position queries

### Analytics Service

**main.py** (350+ lines)
- FastAPI web service
- Three ML algorithms with sklearn
- Feature normalization and preprocessing
- Real-time clustering on demand

## 🔧 Configuration

### Backend (application.properties)

```properties
lune.tle-api.base-url=https://tle.ivanstanojevic.me
server.port=8080
server.servlet.context-path=/
```

### Environment Setup

```bash
# Backend
cd backend && ./mvnw clean install

# Frontend
cd frontend && npm install && npm run build

# Analytics
cd analytics-service && pip install -r requirements.txt
```

## 📡 Data Flow

1. **Frontend** requests satellites via `/api/satellites`
2. **Backend** queries TLE catalog (with intelligent caching)
3. **SGP4 Propagator** calculates positions for visualization
4. **Globe.gl** renders satellites on 3D globe
5. **User selects satellites** → **Analytics Panel** opens
6. **Python service** performs clustering on orbital parameters
7. **Results** visualized with color-coded clusters

## 🎯 Use Cases

- **Space Agencies**: Track active missions and constellation health
- **Amateur Astronomers**: Identify and track visible satellites
- **Data Scientists**: Analyze orbital patterns and anomalies
- **Educators**: Understand satellite dynamics and orbital mechanics
- **Mission Planners**: Visualize and plan future trajectories

## 🚧 Future Enhancements

- Real-time ISS pass predictions
- Satellite collision detection
- Advanced ephemeris calculations
- WebSocket for live updates
- Historical trajectory playback
- Satellite imagery integration
- Mobile-responsive UI improvements

## 📝 License

Open source. See LICENSE for details.

---

**Project by**: Vineet Panchal  
**Contact**: [vineetpanchal03@gmail.com](mailto:vineetpanchal03@gmail.com)  
**Repository**: [github.com/vineet-panchal/lune](https://github.com/vineet-panchal/lune)
