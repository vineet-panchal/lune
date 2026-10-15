package com.lune.backend.trips;

import com.lune.backend.mission.FeedCache;
import com.lune.backend.trips.dto.MissionEventDto;
import com.lune.backend.trips.dto.TrajectoryDto;
import com.lune.backend.trips.dto.TripMissionDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Spacecraft paths from JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api, no key), cached through
 * {@link FeedCache} so a mission is downloaded once and then served from memory and disk.
 *
 * Each mission is one coarse request over its whole flight plus a fine one around every flyby, arrival and
 * landing, where the path bends sharply. The pieces are merged and then thinned: a point is dropped when cubic
 * Hermite interpolation from its neighbours (positions and velocities) lands within {@link #TOLERANCE_AU} of it.
 */
@Service
@RequiredArgsConstructor
public class HorizonsTrajectories {

    private static final String API = "https://ssd.jpl.nasa.gov/api/horizons.api";
    private static final long DAY_MS = 86_400_000L;
    /** Finished missions never change; JPL re-plans flying ones now and then. */
    private static final long COMPLETE_REFRESH_MS = 365 * DAY_MS;
    private static final long FLYING_REFRESH_MS = 7 * DAY_MS;
    /** Roughly how many points the coarse request asks for (Horizons allows ~90k lines). */
    private static final int COARSE_POINTS = 12_000;
    private static final long FINE_HALF_WIDTH_MS = 3 * DAY_MS;
    private static final int FINE_STEP_MINUTES = 30;
    /** 1,500 km: far below a pixel at solar-system scale. */
    static final double TOLERANCE_AU = 1e-5;
    /** Longest run of points one Hermite segment may replace. */
    private static final int MAX_SKIP = 400;
    /** Horizons times are TDB; TDB − UTC is 69.184 s since 2017 (and within 21 s of that since 1972). */
    private static final long TDB_MINUS_UTC_MS = 69_184L;
    private static final double JD_UNIX_EPOCH = 2_440_587.5;
    private static final Set<String> FINE_KINDS = Set.of("flyby", "arrival", "landing", "end");
    private static final DateTimeFormatter HORIZONS_TIME = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm").withZone(ZoneOffset.UTC);

    /** Positions (AU) and velocities (AU/day) as Horizons returned them, before merging. */
    record Samples(double[] t, double[] p, double[] v) {
        int size() {
            return t.length;
        }
    }

    private record Window(long startMs, long stopMs) {
        boolean contains(double t) {
            return t >= startMs && t <= stopMs;
        }
    }

    private record Merged(List<String> versions, TrajectoryDto trajectory) {}

    private final FeedCache feeds;
    private final Map<String, Merged> merged = new ConcurrentHashMap<>();

    /** The mission's path as far as it has been downloaded; loading=true while any piece is still on its way. */
    public FeedCache.Result<TrajectoryDto> trajectory(TripMissions.Mission mission) {
        TripMissionDto info = mission.info();
        long start = Instant.parse(info.dataStart()).toEpochMilli();
        long stop = Instant.parse(info.dataStop()).toEpochMilli();
        long refresh = "complete".equals(info.status()) ? COMPLETE_REFRESH_MS : FLYING_REFRESH_MS;

        FeedCache.Result<Samples> coarse = feeds.get(coarseSpec(mission, start, stop, refresh));
        List<Window> windows = fineWindows(info, start, stop);
        List<FeedCache.Result<Samples>> fine = new ArrayList<>();
        for (Window w : windows) {
            fine.add(feeds.get(fineSpec(mission, w, refresh)));
        }

        boolean loading = coarse.loading() || fine.stream().anyMatch(FeedCache.Result::loading);
        String error = coarse.error() != null ? coarse.error()
                : fine.stream().map(FeedCache.Result::error).filter(e -> e != null).findFirst().orElse(null);
        if (coarse.data() == null) {
            return new FeedCache.Result<>(null, null, loading || error == null, error);
        }

        // Merging and thinning takes a moment for the long missions: only redo it when a piece has changed.
        List<String> versions = new ArrayList<>();
        versions.add(coarse.updatedAt());
        fine.forEach(f -> versions.add(f.data() == null ? null : f.updatedAt()));
        Merged cached = merged.get(info.id());
        if (cached == null || !cached.versions().equals(versions)) {
            List<Samples> finePieces = new ArrayList<>();
            List<Window> fineWindows = new ArrayList<>();
            for (int i = 0; i < windows.size(); i++) {
                if (fine.get(i).data() != null) {
                    finePieces.add(fine.get(i).data());
                    fineWindows.add(windows.get(i));
                }
            }
            cached = new Merged(versions, thin(merge(coarse.data(), finePieces, fineWindows)));
            merged.put(info.id(), cached);
        }
        return new FeedCache.Result<>(cached.trajectory(), coarse.updatedAt(), loading, error);
    }

    // ── Requests ──

    private FeedCache.Spec<Samples> coarseSpec(TripMissions.Mission mission, long start, long stop, long refresh) {
        long stepMinutes = Math.max(120, (long) Math.ceil((stop - start) / 60_000.0 / COARSE_POINTS / 60.0) * 60);
        return new FeedCache.Spec<>("trip-" + mission.info().id(),
                url(mission.horizonsId(), start, stop, stepMinutes), refresh, HorizonsTrajectories::parse);
    }

    private FeedCache.Spec<Samples> fineSpec(TripMissions.Mission mission, Window w, long refresh) {
        String name = "trip-" + mission.info().id() + "-" + HORIZONS_TIME.format(Instant.ofEpochMilli(w.startMs()))
                .replace(' ', 'T').replace(":", "");
        return new FeedCache.Spec<>(name, url(mission.horizonsId(), w.startMs(), w.stopMs(), FINE_STEP_MINUTES),
                refresh, HorizonsTrajectories::parse);
    }

    /** ±3 days around each encounter, inside the data range, with overlapping windows joined. */
    static List<Window> fineWindows(TripMissionDto info, long start, long stop) {
        List<Window> raw = new ArrayList<>();
        for (MissionEventDto e : info.events()) {
            if (!FINE_KINDS.contains(e.kind())) continue;
            long t = Instant.parse(e.time()).toEpochMilli();
            long a = Math.max(start, t - FINE_HALF_WIDTH_MS);
            long b = Math.min(stop, t + FINE_HALF_WIDTH_MS);
            if (b - a > FINE_STEP_MINUTES * 60_000L * 4) raw.add(new Window(a, b));
        }
        raw.sort(Comparator.comparingLong(Window::startMs));
        List<Window> joined = new ArrayList<>();
        for (Window w : raw) {
            Window last = joined.isEmpty() ? null : joined.get(joined.size() - 1);
            if (last != null && w.startMs() <= last.stopMs()) {
                joined.set(joined.size() - 1, new Window(last.startMs(), Math.max(last.stopMs(), w.stopMs())));
            } else {
                joined.add(w);
            }
        }
        return joined;
    }

    private static String url(String target, long startMs, long stopMs, long stepMinutes) {
        return API + "?format=json&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=VECTORS&CENTER=%27500@10%27"
                + "&REF_PLANE=ECLIPTIC&REF_SYSTEM=ICRF&VEC_TABLE=2&OUT_UNITS=AU-D&CSV_FORMAT=YES&VEC_LABELS=NO"
                + "&COMMAND=%27" + target + "%27"
                + "&START_TIME=%27" + HORIZONS_TIME.format(Instant.ofEpochMilli(startMs)).replace(" ", "%20") + "%27"
                + "&STOP_TIME=%27" + HORIZONS_TIME.format(Instant.ofEpochMilli(stopMs)).replace(" ", "%20") + "%27"
                + "&STEP_SIZE=%27" + stepMinutes + "%20m%27";
    }

    // ── Parsing ──

    /** Reads the CSV vector table between $$SOE and $$EOE: JD (TDB), calendar date, X, Y, Z, VX, VY, VZ. */
    static Samples parse(JsonNode root) {
        if (root.hasNonNull("error")) {
            throw new IllegalStateException(root.get("error").asString());
        }
        String result = root.path("result").asString("");
        int soe = result.indexOf("$$SOE");
        int eoe = result.indexOf("$$EOE");
        if (soe < 0 || eoe < soe) {
            throw new IllegalStateException("No vector table in the Horizons answer");
        }
        String[] lines = result.substring(soe + 5, eoe).trim().split("\\R");
        int n = lines.length;
        double[] t = new double[n];
        double[] p = new double[n * 3];
        double[] v = new double[n * 3];
        int count = 0;
        for (String line : lines) {
            String[] f = line.split(",");
            if (f.length < 8) continue;
            double jd = Double.parseDouble(f[0].trim());
            t[count] = Math.round((jd - JD_UNIX_EPOCH) * DAY_MS) - TDB_MINUS_UTC_MS;
            for (int k = 0; k < 3; k++) {
                p[count * 3 + k] = Double.parseDouble(f[2 + k].trim());
                v[count * 3 + k] = Double.parseDouble(f[5 + k].trim());
            }
            count++;
        }
        if (count < 2) {
            throw new IllegalStateException("Horizons returned fewer than two points");
        }
        return new Samples(Arrays.copyOf(t, count), Arrays.copyOf(p, count * 3), Arrays.copyOf(v, count * 3));
    }

    // ── Merging and thinning ──

    /** The coarse points outside the fine windows, plus every fine point, in time order. */
    static Samples merge(Samples coarse, List<Samples> fine, List<Window> windows) {
        List<double[]> rows = new ArrayList<>();
        for (int i = 0; i < coarse.size(); i++) {
            double t = coarse.t()[i];
            if (windows.stream().noneMatch(w -> w.contains(t))) rows.add(row(coarse, i));
        }
        for (Samples s : fine) {
            for (int i = 0; i < s.size(); i++) rows.add(row(s, i));
        }
        rows.sort(Comparator.comparingDouble(r -> r[0]));
        int n = rows.size();
        double[] t = new double[n];
        double[] p = new double[n * 3];
        double[] v = new double[n * 3];
        int count = 0;
        for (double[] r : rows) {
            if (count > 0 && r[0] <= t[count - 1]) continue; // same instant from two pieces
            t[count] = r[0];
            System.arraycopy(r, 1, p, count * 3, 3);
            System.arraycopy(r, 4, v, count * 3, 3);
            count++;
        }
        return new Samples(Arrays.copyOf(t, count), Arrays.copyOf(p, count * 3), Arrays.copyOf(v, count * 3));
    }

    private static double[] row(Samples s, int i) {
        return new double[]{s.t()[i], s.p()[i * 3], s.p()[i * 3 + 1], s.p()[i * 3 + 2], s.v()[i * 3], s.v()[i * 3 + 1], s.v()[i * 3 + 2]};
    }

    /** Keeps only the points Hermite interpolation can't reproduce from the points kept around them. */
    static TrajectoryDto thin(Samples s) {
        int n = s.size();
        List<Integer> keep = new ArrayList<>();
        keep.add(0);
        int anchor = 0;
        while (anchor < n - 1) {
            int end = anchor + 1;
            // Extend the segment while every point it skips stays within tolerance.
            while (end + 1 < n && end + 1 - anchor <= MAX_SKIP && fits(s, anchor, end + 1)) {
                end++;
            }
            keep.add(end);
            anchor = end;
        }
        int m = keep.size();
        double[] t = new double[m];
        double[] p = new double[m * 3];
        double[] v = new double[m * 3];
        for (int j = 0; j < m; j++) {
            int i = keep.get(j);
            t[j] = s.t()[i];
            for (int k = 0; k < 3; k++) {
                p[j * 3 + k] = round(s.p()[i * 3 + k], 1e9);
                v[j * 3 + k] = round(s.v()[i * 3 + k], 1e11);
            }
        }
        return new TrajectoryDto(t, p, v);
    }

    private static boolean fits(Samples s, int a, int b) {
        double hDays = (s.t()[b] - s.t()[a]) / DAY_MS;
        for (int i = a + 1; i < b; i++) {
            double u = (s.t()[i] - s.t()[a]) / (s.t()[b] - s.t()[a]);
            double h00 = 2 * u * u * u - 3 * u * u + 1;
            double h10 = u * u * u - 2 * u * u + u;
            double h01 = -2 * u * u * u + 3 * u * u;
            double h11 = u * u * u - u * u;
            double err2 = 0;
            for (int k = 0; k < 3; k++) {
                double x = h00 * s.p()[a * 3 + k] + h10 * hDays * s.v()[a * 3 + k]
                        + h01 * s.p()[b * 3 + k] + h11 * hDays * s.v()[b * 3 + k];
                double d = x - s.p()[i * 3 + k];
                err2 += d * d;
            }
            if (err2 > TOLERANCE_AU * TOLERANCE_AU) return false;
        }
        return true;
    }

    private static double round(double x, double scale) {
        return Math.round(x * scale) / scale;
    }
}
