package com.lune.backend.trips;

import com.lune.backend.mission.FeedCache;
import com.lune.backend.trips.dto.MoonElementsDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Map;

/**
 * Orbits of the moons astronomy-engine doesn't have (it covers our Moon and Jupiter's four big ones), from JPL
 * Horizons as osculating elements every 2 days from 2015 to 2065. One download per moon, kept a year: the
 * satellite ephemerides behind them change only when JPL publishes a new solution. The browser asks for one year
 * at a time, so it never loads more than ~200 samples.
 */
@Service
@RequiredArgsConstructor
public class MoonEphemerides {

    private static final String API = "https://ssd.jpl.nasa.gov/api/horizons.api";
    private static final long DAY_MS = 86_400_000L;
    private static final long REFRESH_MS = 365 * DAY_MS;
    static final int FIRST_YEAR = 2015;
    static final int LAST_YEAR = 2064;
    private static final long TDB_MINUS_UTC_MS = 69_184L;
    private static final double JD_UNIX_EPOCH = 2_440_587.5;

    /** A moon Lune asks Horizons about: its target id and its planet's. */
    record Moon(String horizonsId, String centerId) {}

    static final Map<String, Moon> MOONS = Map.of(
            "Phobos", new Moon("401", "499"),
            "Deimos", new Moon("402", "499"),
            "Enceladus", new Moon("602", "699"),
            "Titan", new Moon("606", "699"),
            "Titania", new Moon("703", "799"),
            "Triton", new Moon("801", "899"),
            "Charon", new Moon("901", "999")
    );

    private final FeedCache feeds;

    public static boolean known(String id) {
        return MOONS.containsKey(id);
    }

    /**
     * The samples falling in a UTC year plus one on either side, so the year's edges interpolate. Years outside
     * the downloaded span get the nearest end of it (propagating from there keeps the orbit's shape right).
     */
    public FeedCache.Result<MoonElementsDto> elements(String id, int year) {
        Moon moon = MOONS.get(id);
        FeedCache.Result<MoonElementsDto> all = feeds.get(spec(id, moon));
        MoonElementsDto data = all.data() == null ? null : slice(all.data(), year);
        return new FeedCache.Result<>(data, all.updatedAt(), all.loading() || (all.data() == null && all.error() == null), all.error());
    }

    private static FeedCache.Spec<MoonElementsDto> spec(String id, Moon moon) {
        String url = API + "?format=json&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=ELEMENTS"
                + "&CENTER=%27500@" + moon.centerId() + "%27&REF_PLANE=FRAME&REF_SYSTEM=ICRF&OUT_UNITS=KM-S&CSV_FORMAT=YES"
                + "&COMMAND=%27" + moon.horizonsId() + "%27"
                + "&START_TIME=%27" + FIRST_YEAR + "-01-01%27&STOP_TIME=%27" + (LAST_YEAR + 1) + "-01-01%27&STEP_SIZE=%272%20d%27";
        return new FeedCache.Spec<>("moon-" + id.toLowerCase(), url, REFRESH_MS, MoonEphemerides::parse);
    }

    static MoonElementsDto slice(MoonElementsDto all, int year) {
        int n = all.t().length;
        if (n == 0) return all;
        long start = LocalDate.of(year, 1, 1).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
        long stop = LocalDate.of(year + 1, 1, 1).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
        int from = 0;
        while (from < n && all.t()[from] < start) from++;
        int to = from;
        while (to < n && all.t()[to] < stop) to++;
        // One sample either side; at least two samples even for years outside the span.
        from = Math.max(0, Math.min(from - 1, n - 2));
        to = Math.min(n, Math.max(to + 1, from + 2));
        return new MoonElementsDto(
                Arrays.copyOfRange(all.t(), from, to), Arrays.copyOfRange(all.a(), from, to),
                Arrays.copyOfRange(all.e(), from, to), Arrays.copyOfRange(all.i(), from, to),
                Arrays.copyOfRange(all.node(), from, to), Arrays.copyOfRange(all.peri(), from, to),
                Arrays.copyOfRange(all.ma(), from, to), Arrays.copyOfRange(all.n(), from, to));
    }

    /**
     * Reads the CSV elements table between $$SOE and $$EOE:
     * JDTDB, calendar date, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR.
     */
    static MoonElementsDto parse(JsonNode root) {
        if (root.hasNonNull("error")) {
            throw new IllegalStateException(root.get("error").asString());
        }
        String result = root.path("result").asString("");
        int soe = result.indexOf("$$SOE");
        int eoe = result.indexOf("$$EOE");
        if (soe < 0 || eoe < soe) {
            throw new IllegalStateException("No elements table in the Horizons answer");
        }
        String[] lines = result.substring(soe + 5, eoe).trim().split("\\R");
        int m = lines.length;
        double[] t = new double[m], a = new double[m], e = new double[m], i = new double[m];
        double[] node = new double[m], peri = new double[m], ma = new double[m], n = new double[m];
        int count = 0;
        for (String line : lines) {
            String[] f = line.split(",");
            if (f.length < 12) continue;
            double jd = Double.parseDouble(f[0].trim());
            t[count] = Math.round((jd - JD_UNIX_EPOCH) * DAY_MS) - TDB_MINUS_UTC_MS;
            e[count] = Double.parseDouble(f[2].trim());
            i[count] = Double.parseDouble(f[4].trim());
            node[count] = Double.parseDouble(f[5].trim());
            peri[count] = Double.parseDouble(f[6].trim());
            n[count] = Double.parseDouble(f[8].trim());
            ma[count] = Double.parseDouble(f[9].trim());
            a[count] = Double.parseDouble(f[11].trim());
            count++;
        }
        if (count < 2) {
            throw new IllegalStateException("Horizons returned fewer than two element sets");
        }
        return new MoonElementsDto(Arrays.copyOf(t, count), Arrays.copyOf(a, count), Arrays.copyOf(e, count),
                Arrays.copyOf(i, count), Arrays.copyOf(node, count), Arrays.copyOf(peri, count),
                Arrays.copyOf(ma, count), Arrays.copyOf(n, count));
    }
}
