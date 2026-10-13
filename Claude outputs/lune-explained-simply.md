# Lune, Explained Simply

A plain-language version of how Lune works — no assumed coding background. Think of this as "explain it like I'm smart but new to this codebase."

## What the app actually does

Lune shows you a spinning 3D Earth in your browser with little dots on it — each dot is a real satellite, in its real current position, moving in real time. You can filter by type (GPS satellites, Starlink, the ISS, weather satellites, and so on), click on one to see its path traced around the Earth, and — in a second mode called "Orbital Intelligence" — ask the computer to automatically group satellites that are "similar" to each other, or flag ones that look unusual.

## The three "workers" behind the scenes

Picture three separate programs running at once, each doing one job, passing information to each other:

**Worker 1 — the Java backend.** This one's job is to fetch satellite data from the outside world and do the orbital math. Real satellite-tracking organizations (like CelesTrak) publish a data format called a "TLE" (Two-Line Element set) — literally two lines of numbers per satellite that encode its orbit. Worker 1 downloads these, and uses a math library to turn "here's a TLE and the current time" into "here's exactly where that satellite is right now, in latitude/longitude/altitude." It also keeps a temporary memory (a cache) of recent answers, so it doesn't have to re-download the same data over and over.

**Worker 2 — the Python analytics worker.** This one only does one thing: given a list of satellite positions, it groups them using off-the-shelf machine learning tools (the same kind of "clustering" algorithms used for things like customer segmentation, just applied to satellites instead). It doesn't talk to the internet or store anything — you hand it numbers, it hands back groups.

**Worker 3 — the website you actually see.** Built with React (a common way to build interactive websites) and a 3D graphics library, this is what draws the globe, handles your clicks, and shows the menus. It's the one you interact with directly; it talks to Worker 1 to get satellite data and, when you use the analytics panel, asks Worker 1 to pass a request along to Worker 2.

So the flow is: **your browser (Worker 3) asks the Java backend (Worker 1) for satellite data → Worker 1 fetches it from the real-world satellite catalog and does the position math → your browser draws it on the globe.** For the clustering feature: **your browser sends satellite positions to Worker 1 → Worker 1 forwards them to the Python worker (Worker 2) → Worker 2 sends back groupings → your browser colors the dots accordingly.**

## The cleverest part of the project

Here's the thing that makes this actually work well instead of just being a neat demo: the app does **not** ask the server "where is this satellite?" every single second for every single satellite. If it did, tracking a few thousand Starlink satellites would mean thousands of requests per second — way too slow and expensive.

Instead, it downloads each satellite's TLE data **once**, and then does all the "where is it *right now*" math **directly in your browser**, using the same kind of orbital-math library, just a JavaScript version. Your own computer recalculates every satellite's position once a second (or a bit slower if you're tracking a lot of them), purely with math — no internet needed for that part. This is the difference between "download the recipe once, cook it yourself" versus "call the restaurant and ask them to re-cook the same dish every single second." It's a genuinely smart performance decision, and probably the single best thing to point to if someone asks "what's the hard part of this project?"

## How the globe actually gets drawn

The 3D Earth itself comes from a graphics library (built on top of a bigger 3D engine called Three.js — the same kind of tech behind browser games). Each satellite is drawn as a tiny 3D sphere, positioned using its latitude, longitude, and altitude, the same way you'd place a pin on a map, just also lifted up by however high the satellite actually orbits. Colors are assigned automatically — for example, satellites are shaded by how high up they orbit (a "shell" close to Earth gets one color, way out near geostationary orbit gets another), or by which cluster they got sorted into if you've run the grouping feature.

## The "coming soon" parts, so you're not caught off guard

Two features exist as menu options but aren't really finished: "future launches" and "trajectory planning to Mars." Right now those just return a couple of hand-typed example missions and a fake, straight-line path — placeholders for features that would need real spaceflight-schedule data and real trajectory math to actually work. That's fine and normal for a portfolio project — just don't describe them as fully working if asked.

## If someone asks "did you build this yourself?"

You don't need to have hand-written the orbital physics equations to genuinely understand and own this project — almost no engineer does; using well-tested libraries for hard math (like orbital mechanics) instead of reinventing it is normal, good practice. What you *do* own, and should be able to explain confidently, is the overall design: three services that each do one job, a smart decision to compute satellite positions on the user's own computer instead of hammering a server, a fallback plan for when the satellite-data source is slow or unavailable, and a separate machine-learning service kept independent from the main app so each piece can be understood and changed on its own. That's the real engineering story here, and it's a solid one.
