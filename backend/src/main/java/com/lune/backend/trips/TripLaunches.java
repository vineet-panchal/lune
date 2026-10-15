package com.lune.backend.trips;

import com.lune.backend.mission.FeedCache;
import com.lune.backend.mission.MissionFeeds;
import com.lune.backend.mission.dto.LaunchDto;
import com.lune.backend.trips.dto.TripLaunchDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Upcoming launches heading for a planet or a moon, read from Launch Library 2. Mission Control's upcoming feed
 * only holds the next 15 launches (a few weeks), so this adds one wider request for the next 100, refreshed
 * twice a day to stay well inside Launch Library's 15 requests an hour. Both are cached by {@link FeedCache}.
 *
 * Launch Library has no "destination" field. It is read from the mission's orbit ("Mars Orbit", "Lunar Orbit")
 * or, for heliocentric missions, from the first planet or moon its name and description mention; the reason is
 * passed on so the UI can show it.
 */
@Service
@RequiredArgsConstructor
public class TripLaunches {

    private static final long HOUR_MS = 3_600_000L;
    static final FeedCache.Spec<List<LaunchDto>> WIDE = new FeedCache.Spec<>(
            "trip-launches", "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=100&mode=normal",
            12 * HOUR_MS, MissionFeeds::parseLaunches);

    /** Destinations Trips can plan, moons first so "Phobos" wins over the "Mars" in the same sentence. */
    private static final Map<String, String> MOON_PLANET = new LinkedHashMap<>();
    private static final List<String> PLANETS = List.of("Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto");

    static {
        MOON_PLANET.put("Phobos", "Mars");
        MOON_PLANET.put("Deimos", "Mars");
        MOON_PLANET.put("Io", "Jupiter");
        MOON_PLANET.put("Europa", "Jupiter");
        MOON_PLANET.put("Ganymede", "Jupiter");
        MOON_PLANET.put("Callisto", "Jupiter");
        MOON_PLANET.put("Enceladus", "Saturn");
        MOON_PLANET.put("Titan", "Saturn");
        MOON_PLANET.put("Titania", "Uranus");
        MOON_PLANET.put("Triton", "Neptune");
        MOON_PLANET.put("Charon", "Pluto");
    }

    private static final Pattern HELIOCENTRIC = Pattern.compile("heliocentric|interplanetary|escape|deep space", Pattern.CASE_INSENSITIVE);
    private static final Pattern LUNAR = Pattern.compile("\\blunar\\b|\\bmoon\\b", Pattern.CASE_INSENSITIVE);
    /** "Io" and "Titan" are also everyday words or rocket names, so only match them as whole, capitalised words. */
    private static final Map<String, Pattern> NAME_PATTERNS = new LinkedHashMap<>();

    static {
        MOON_PLANET.keySet().forEach(n -> NAME_PATTERNS.put(n, Pattern.compile("\\b" + n + "\\b")));
        PLANETS.forEach(n -> NAME_PATTERNS.put(n, Pattern.compile("\\b" + n + "\\b")));
    }

    private final FeedCache feeds;
    private final MissionFeeds missionFeeds;

    /** Planetary and lunar launches, soonest first, from both feeds (whatever has arrived so far). */
    public FeedCache.Result<List<TripLaunchDto>> upcoming() {
        FeedCache.Result<List<LaunchDto>> soon = missionFeeds.upcomingLaunches();
        FeedCache.Result<List<LaunchDto>> wide = feeds.get(WIDE);
        Map<String, LaunchDto> byId = new LinkedHashMap<>();
        for (FeedCache.Result<List<LaunchDto>> r : List.of(wide, soon)) {
            if (r.data() != null) r.data().forEach(l -> byId.put(l.id(), l));
        }
        List<TripLaunchDto> out = new ArrayList<>();
        for (LaunchDto l : byId.values()) {
            TripLaunchDto t = classify(l);
            if (t != null) out.add(t);
        }
        out.sort(Comparator.comparing(t -> t.launch().net() == null ? "" : t.launch().net()));
        boolean noData = soon.data() == null && wide.data() == null;
        String error = wide.error() != null ? wide.error() : soon.error();
        String updatedAt = wide.updatedAt() != null ? wide.updatedAt() : soon.updatedAt();
        return new FeedCache.Result<>(noData ? null : out, updatedAt, wide.loading() || soon.loading() || (noData && error == null), error);
    }

    /** The launch's destination if it heads for a planet or a moon, else null. */
    static TripLaunchDto classify(LaunchDto l) {
        String orbit = l.orbit() == null ? "" : l.orbit();
        String text = String.join(" ", nz(l.missionName()), nz(l.missionDescription()));

        if (LUNAR.matcher(orbit).find()) {
            return new TripLaunchDto(l, "Moon", "Earth", "orbit: " + orbit);
        }
        for (String p : PLANETS) {
            if (orbit.toLowerCase(Locale.ROOT).contains(p.toLowerCase(Locale.ROOT))) {
                String moon = firstMoonOf(p, text);
                return new TripLaunchDto(l, moon != null ? moon : p, p, "orbit: " + orbit + (moon != null ? "; mentions " + moon : ""));
            }
        }
        if (HELIOCENTRIC.matcher(orbit).find()) {
            String body = firstMentioned(text);
            if (body != null) {
                String planet = MOON_PLANET.getOrDefault(body, body);
                return new TripLaunchDto(l, body, planet, "orbit: " + orbit + "; mentions " + body);
            }
        }
        return null;
    }

    private static String firstMoonOf(String planet, String text) {
        String best = null;
        int bestAt = Integer.MAX_VALUE;
        for (Map.Entry<String, String> m : MOON_PLANET.entrySet()) {
            if (!m.getValue().equals(planet)) continue;
            Matcher x = NAME_PATTERNS.get(m.getKey()).matcher(text);
            if (x.find() && x.start() < bestAt) {
                best = m.getKey();
                bestAt = x.start();
            }
        }
        return best;
    }

    /** The planet or moon named earliest in the text (a moon wins a tie with its planet further on). */
    private static String firstMentioned(String text) {
        String best = null;
        int bestAt = Integer.MAX_VALUE;
        for (Map.Entry<String, Pattern> e : NAME_PATTERNS.entrySet()) {
            Matcher x = e.getValue().matcher(text);
            if (x.find() && x.start() < bestAt) {
                best = e.getKey();
                bestAt = x.start();
            }
        }
        if (best != null && PLANETS.contains(best)) {
            String moon = firstMoonOf(best, text);
            if (moon != null) return moon;
        }
        return best;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
