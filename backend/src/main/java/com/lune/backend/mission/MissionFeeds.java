package com.lune.backend.mission;

import com.lune.backend.mission.dto.ExpeditionDto;
import com.lune.backend.mission.dto.FlybyDto;
import com.lune.backend.mission.dto.LaunchDto;
import com.lune.backend.mission.dto.NewsArticleDto;
import com.lune.backend.mission.dto.SpaceWeatherDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The outside feeds on Mission Control, each turned into the small shape the UI needs:
 *  - news:          Spaceflight News API (no key)
 *  - launches, crew: Launch Library 2 (no key, but only 15 requests an hour, so these refresh slowly)
 *  - space weather: NOAA SWPC (no key)
 *  - flybys:        JPL close-approach data (no key)
 */
@Service
@RequiredArgsConstructor
public class MissionFeeds {

    private static final long MINUTE_MS = 60_000L;
    private static final String LL2 = "https://ll.thespacedevs.com/2.3.0";
    private static final String SWPC = "https://services.swpc.noaa.gov";

    private static final double AU_KM = 149_597_870.7;
    private static final double LUNAR_DISTANCE_KM = 384_400;
    /** Kp history shown before now; the forecast feed carries a week of it. */
    private static final long KP_HISTORY_MS = 3 * 86_400_000L;
    private static final DateTimeFormatter JPL_TIME = DateTimeFormatter.ofPattern("uuuu-MMM-dd HH:mm", Locale.ENGLISH);

    /** Stations Lune can track (both are in the tracker's Popular list). */
    private static final Map<String, Integer> STATION_NORAD_IDS = Map.of(
            "International Space Station", 25544,
            "Tiangong", 48274
    );

    static final FeedCache.Spec<List<NewsArticleDto>> NEWS = new FeedCache.Spec<>(
            "news", "https://api.spaceflightnewsapi.net/v4/articles/?limit=40", 10 * MINUTE_MS, MissionFeeds::parseNews);
    static final FeedCache.Spec<List<LaunchDto>> UPCOMING = new FeedCache.Spec<>(
            "launches-upcoming", LL2 + "/launches/upcoming/?limit=15&mode=normal", 30 * MINUTE_MS, MissionFeeds::parseLaunches);
    static final FeedCache.Spec<List<LaunchDto>> RECENT = new FeedCache.Spec<>(
            "launches-recent", LL2 + "/launches/previous/?limit=15&mode=normal", 90 * MINUTE_MS, MissionFeeds::parseLaunches);
    static final FeedCache.Spec<List<ExpeditionDto>> CREW = new FeedCache.Spec<>(
            "expeditions", LL2 + "/expeditions/?is_active=true&mode=detailed&limit=10", 6 * 60 * MINUTE_MS, MissionFeeds::parseExpeditions);
    static final FeedCache.Spec<List<SpaceWeatherDto.KpPoint>> KP = new FeedCache.Spec<>(
            "kp", SWPC + "/products/noaa-planetary-k-index-forecast.json", 15 * MINUTE_MS, MissionFeeds::parseKp);
    static final FeedCache.Spec<SpaceWeatherDto.Scales> SCALES = new FeedCache.Spec<>(
            "swpc-scales", SWPC + "/products/noaa-scales.json", 15 * MINUTE_MS, MissionFeeds::parseScales);
    static final FeedCache.Spec<SpaceWeatherDto.Flare> FLARE = new FeedCache.Spec<>(
            "xray-flare", SWPC + "/json/goes/primary/xray-flares-latest.json", 15 * MINUTE_MS, MissionFeeds::parseFlare);
    static final FeedCache.Spec<List<FlybyDto>> FLYBYS = new FeedCache.Spec<>(
            "flybys", "https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=now&date-max=%2B60&sort=date",
            6 * 60 * MINUTE_MS, MissionFeeds::parseFlybys);

    public record SpaceWeather(
            FeedCache.Result<List<SpaceWeatherDto.KpPoint>> kp,
            FeedCache.Result<SpaceWeatherDto.Scales> scales,
            FeedCache.Result<SpaceWeatherDto.Flare> flare
    ) {}

    private final FeedCache feeds;

    public FeedCache.Result<List<NewsArticleDto>> news() {
        return feeds.get(NEWS);
    }

    public FeedCache.Result<List<LaunchDto>> upcomingLaunches() {
        return feeds.get(UPCOMING);
    }

    public FeedCache.Result<List<LaunchDto>> recentLaunches() {
        return feeds.get(RECENT);
    }

    public FeedCache.Result<List<ExpeditionDto>> crew() {
        return feeds.get(CREW);
    }

    public SpaceWeather spaceWeather() {
        FeedCache.Result<List<SpaceWeatherDto.KpPoint>> kp = feeds.get(KP);
        // The feed keeps a week of history; the chart shows the last three days and the forecast.
        long since = System.currentTimeMillis() - KP_HISTORY_MS;
        List<SpaceWeatherDto.KpPoint> recent = kp.data() == null ? null
                : kp.data().stream().filter(p -> Instant.parse(p.time()).toEpochMilli() >= since).toList();
        return new SpaceWeather(new FeedCache.Result<>(recent, kp.updatedAt(), kp.loading(), kp.error()),
                feeds.get(SCALES), feeds.get(FLARE));
    }

    public FeedCache.Result<List<FlybyDto>> flybys() {
        return feeds.get(FLYBYS);
    }

    // ── Parsers ──

    static List<NewsArticleDto> parseNews(JsonNode root) {
        List<NewsArticleDto> articles = new ArrayList<>();
        for (JsonNode a : array(root.path("results"))) {
            List<String> launchIds = new ArrayList<>();
            for (JsonNode l : a.path("launches")) {
                String id = text(l, "launch_id");
                if (id != null) launchIds.add(id);
            }
            articles.add(new NewsArticleDto(a.path("id").asLong(), text(a, "title"), text(a, "summary"), text(a, "url"),
                    text(a, "image_url"), text(a, "news_site"), text(a, "published_at"), launchIds));
        }
        return articles;
    }

    public static List<LaunchDto> parseLaunches(JsonNode root) {
        List<LaunchDto> launches = new ArrayList<>();
        for (JsonNode l : array(root.path("results"))) {
            JsonNode mission = l.path("mission");
            JsonNode pad = l.path("pad");
            JsonNode orbit = mission.path("orbit");
            String videoUrl = null;
            for (JsonNode v : mission.path("vid_urls")) {
                videoUrl = text(v, "url");
                if (videoUrl != null) break;
            }
            launches.add(new LaunchDto(
                    text(l, "id"),
                    text(l, "name"),
                    text(mission, "name"),
                    text(l.path("status"), "abbrev"),
                    text(l.path("status"), "name"),
                    text(l, "net"),
                    text(l.path("net_precision"), "abbrev"),
                    text(l, "window_start"),
                    text(l, "window_end"),
                    text(l.path("launch_service_provider"), "name"),
                    text(l.path("rocket").path("configuration"), "full_name"),
                    text(mission, "type"),
                    text(mission, "description"),
                    text(orbit, "name"),
                    text(pad, "name"),
                    text(pad.path("location"), "name"),
                    text(pad.path("country"), "alpha_2_code"),
                    number(pad, "latitude"),
                    number(pad, "longitude"),
                    text(l.path("image"), "image_url"),
                    text(l.path("image"), "thumbnail_url"),
                    text(l, "launch_designator"),
                    l.path("webcast_live").asBoolean(false),
                    videoUrl,
                    text(l, "failreason"),
                    l.path("probability").isNumber() ? l.path("probability").asInt() : null));
        }
        return launches;
    }

    static List<ExpeditionDto> parseExpeditions(JsonNode root) {
        List<ExpeditionDto> expeditions = new ArrayList<>();
        for (JsonNode e : array(root.path("results"))) {
            List<ExpeditionDto.CrewMember> crew = new ArrayList<>();
            for (JsonNode c : e.path("crew")) {
                JsonNode a = c.path("astronaut");
                crew.add(new ExpeditionDto.CrewMember(
                        text(a, "name"),
                        text(c.path("role"), "role"),
                        text(a.path("agency"), "abbrev"),
                        text(a.path("nationality").path(0), "alpha_2_code"),
                        text(a.path("image"), "thumbnail_url"),
                        text(a, "wiki"),
                        a.path("flights_count").isNumber() ? a.path("flights_count").asInt() : null,
                        text(a, "time_in_space")));
            }
            String station = text(e.path("spacestation"), "name");
            Integer noradId = station == null ? null : STATION_NORAD_IDS.entrySet().stream()
                    .filter(s -> station.contains(s.getKey())).map(Map.Entry::getValue).findFirst().orElse(null);
            expeditions.add(new ExpeditionDto(text(e, "name"), station, noradId, text(e, "start"), crew));
        }
        return expeditions;
    }

    static List<SpaceWeatherDto.KpPoint> parseKp(JsonNode root) {
        List<SpaceWeatherDto.KpPoint> points = new ArrayList<>();
        for (JsonNode p : array(root)) {
            String time = text(p, "time_tag");
            if (time == null || !p.path("kp").isNumber()) continue;
            points.add(new SpaceWeatherDto.KpPoint(time.endsWith("Z") ? time : time + "Z", p.path("kp").asDouble(),
                    text(p, "observed"), text(p, "noaa_scale")));
        }
        return points;
    }

    /** Keys "-1" (last 24 h), "0" (now), "1".."3" (the next days). */
    static SpaceWeatherDto.Scales parseScales(JsonNode root) {
        if (!root.isObject() || root.path("0").isMissingNode()) {
            throw new IllegalStateException("unexpected scales response");
        }
        List<SpaceWeatherDto.Outlook> forecast = new ArrayList<>();
        for (int day = 1; day <= 3; day++) {
            JsonNode d = root.path(String.valueOf(day));
            if (d.isMissingNode()) continue;
            forecast.add(new SpaceWeatherDto.Outlook(text(d, "DateStamp"), integer(text(d.path("R"), "MinorProb")),
                    integer(text(d.path("R"), "MajorProb")), integer(text(d.path("S"), "Prob")), level(d.path("G"))));
        }
        return new SpaceWeatherDto.Scales(levels(root.path("0")), levels(root.path("-1")), forecast);
    }

    static SpaceWeatherDto.Flare parseFlare(JsonNode root) {
        JsonNode f = array(root).isEmpty() ? null : root.path(0);
        if (f == null) return null;
        return new SpaceWeatherDto.Flare(text(f, "max_class"), text(f, "max_time"), text(f, "begin_time"),
                text(f, "end_time"), text(f, "current_class"));
    }

    static List<FlybyDto> parseFlybys(JsonNode root) {
        Map<String, Integer> col = new HashMap<>();
        List<JsonNode> fields = array(root.path("fields"));
        for (int i = 0; i < fields.size(); i++) {
            col.put(fields.get(i).asString(), i);
        }
        List<FlybyDto> flybys = new ArrayList<>();
        for (JsonNode row : root.path("data")) {
            double distanceKm = row.path(col.get("dist")).asDouble() * AU_KM;
            double h = row.path(col.get("h")).asDouble(Double.NaN);
            String time = LocalDateTime.parse(row.path(col.get("cd")).asString(), JPL_TIME).toInstant(ZoneOffset.UTC).toString();
            flybys.add(new FlybyDto(row.path(col.get("des")).asString(), time, Math.round(distanceKm),
                    Math.round(distanceKm / LUNAR_DISTANCE_KM * 100) / 100.0,
                    Math.round(row.path(col.get("v_rel")).asDouble() * 100) / 100.0, h,
                    Math.round(diameterM(h, 0.25)), Math.round(diameterM(h, 0.05))));
        }
        return flybys;
    }

    /** Asteroid diameter from absolute magnitude H and an assumed surface brightness (albedo). */
    private static double diameterM(double h, double albedo) {
        return 1329.0 / Math.sqrt(albedo) * Math.pow(10, -h / 5) * 1000;
    }

    private static SpaceWeatherDto.Levels levels(JsonNode day) {
        return new SpaceWeatherDto.Levels(level(day.path("R")), level(day.path("S")), level(day.path("G")));
    }

    private static int level(JsonNode scale) {
        Integer value = integer(text(scale, "Scale"));
        return value == null ? 0 : value;
    }

    // ── JSON helpers: missing, null and blank all read as null ──

    private static List<JsonNode> array(JsonNode node) {
        if (!node.isArray()) {
            throw new IllegalStateException("unexpected response: expected a list");
        }
        List<JsonNode> items = new ArrayList<>();
        node.forEach(items::add);
        return items;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String text = value.asString();
        return text.isBlank() ? null : text;
    }

    private static Double number(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isNumber()) return value.asDouble();
        try {
            return value.isString() ? Double.parseDouble(value.asString()) : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer integer(String text) {
        try {
            return text == null ? null : Integer.parseInt(text.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
