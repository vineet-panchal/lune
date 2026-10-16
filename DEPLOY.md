# Deploying Lune to Railway

Lune runs as three services in one [Railway](https://railway.com) project. Each one is built from the Dockerfile in its folder.

```
            internet
               │  https://<your-app>.up.railway.app
        ┌──────▼──────┐
        │  frontend   │  Next.js (port 3000) — the only public service
        └──────┬──────┘
               │ /api/*  (private network)
        ┌──────▼──────┐      ┌──────────────┐
        │  backend    │─────▶│  analytics   │  FastAPI (port 8000)
        │ Spring 8080 │      └──────────────┘
        └──────┬──────┘
          volume /data   (TLE cache, TLE history, feed cache)
```

The browser only talks to the frontend. Next.js forwards `/api/*` to the backend over Railway's private network. This means the backend and analytics services don't need public URLs, and CORS doesn't come into play.

## What's in the repo for this

| File | What it does |
| --- | --- |
| `backend/Dockerfile` | Builds the jar with the Maven wrapper and runs it on a Java 17 JRE. It sets `user.home=/data`, so every `~/.lune` cache lands on the volume. |
| `analytics-service/Dockerfile` | Installs `requirements.txt` and runs `uvicorn` on `::`, which listens on both IPv6 and IPv4. Railway's private network uses IPv6. |
| `frontend/Dockerfile` | Builds Next.js in `standalone` mode and runs the small `server.js` it produces. |
| `application.properties` | Reads the port from `PORT` and the analytics URL from `LUNE_ANALYTICS_BASE_URL`. Both fall back to the local defaults. |

## One-time setup

### 1. Account

1. Sign up at railway.com using **Login with GitHub**.
2. Pick the **Hobby** plan. Railway bills by usage, and a free trial doesn't cover an always-on Java service for long. After the first day, check **Usage** to see what the app actually costs.

### 2. Create the project and the three services

1. **New Project → Deploy from GitHub repo → `vineet-panchal/lune`**. Allow Railway to access the repo when it asks.
2. Railway creates one service. Open it and go to **Settings**:
   - **Service name:** `analytics`. The names matter because the variables below refer to them.
   - **Source → Root Directory:** `/analytics-service`
3. On the project canvas, click **+ Create → GitHub Repo → `lune`** twice more to add two more services:
   - `backend`, with Root Directory `/backend`
   - `frontend`, with Root Directory `/frontend`

Railway finds the `Dockerfile` in each root directory and uses it automatically.

### 3. Variables (each service → **Variables** tab)

**analytics**
```
PORT=8000
```

**backend**
```
PORT=8080
LUNE_ANALYTICS_BASE_URL=http://${{analytics.RAILWAY_PRIVATE_DOMAIN}}:${{analytics.PORT}}
```

**frontend**
```
PORT=3000
BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}
```

Type the `${{...}}` parts exactly as shown. Railway replaces them with the other service's internal address, something like `backend.railway.internal`.

> `BACKEND_URL` is used at **build** time, because Next.js writes the `/api` rewrite into the build. If you change it, redeploy the frontend so it rebuilds.

### 4. Volume for the backend

Right-click the **backend** service (or use the command palette) and choose **Attach volume**. Set the mount path to **`/data`**.

Without the volume, the TLE history used for orbit changes and Mission Control's "Catalog pulse" is wiped on every deploy.

### 5. Public URL for the frontend

**frontend → Settings → Networking → Generate Domain**, target port **3000**. This gives you `https://something.up.railway.app`. You can rename the subdomain there, or add your own domain later.

Don't generate domains for `backend` or `analytics`. They stay private.

### 6. Deploy

Click **Deploy** (or **Apply changes**) at the top of the canvas. The first builds take a few minutes, and Maven is the slowest. Once all three show **Active**, open the frontend URL.

## Checking it works

- **Tracker page:** satellites appear within a few seconds. The first Starlink load takes longer while the backend fetches from CelesTrak.
- **backend → Deploy Logs:** you should see lines like `Catalog GROUP:STARLINK: ... satellites from CelesTrak`.
- **Orbital Intelligence → Models → run k-means:** this proves backend → analytics works.
- **Mission Control** and **Trips** load their cards and missions.

If something fails, read that service's **Deploy Logs** (runtime errors) or **Build Logs** (it didn't build).

| Symptom | Likely cause |
| --- | --- |
| Frontend loads, but every `/api` call is 500 or 502 | `BACKEND_URL` is wrong or was added after the frontend built. Fix it and redeploy the frontend. |
| Clustering fails, everything else works | `LUNE_ANALYTICS_BASE_URL` is wrong, or analytics isn't running. |
| Orbit-change history resets after every deploy | The volume isn't mounted at `/data`. |
| "Application failed to respond" | The domain's target port doesn't match the service's `PORT`. |

## After setup

Every push to `master` redeploys automatically. To stop a frontend-only change from also rebuilding the backend, set **Settings → Watch Paths** on each service, for example `/backend/**` for the backend.
