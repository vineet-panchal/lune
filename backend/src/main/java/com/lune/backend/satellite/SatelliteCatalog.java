package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import com.lune.backend.satellite.dto.TleDto;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory TLE catalog, refreshed in the background so API requests never wait on an upstream.
 *
 * Each entry is a "key" describing what to download:
 *   GROUP:STARLINK         a CelesTrak group
 *   NAME:KUIPER            satellites whose name contains the text
 *   IDS:25544,20580        specific NORAD IDs
 * Entries are loaded on first request (or at startup for {@link #PRELOAD_KEYS}), kept in memory,
 * written to disk so restarts don't re-download, and refreshed once they're older than the refresh interval.
 * Clients propagate positions themselves from these TLEs, so stored TLEs never go "out of date" between refreshes.
 */
@Component
@Slf4j
public class SatelliteCatalog {

    public static final String SOURCE_CELESTRAK = "celestrak";
    public static final String SOURCE_TLE_API = "tle-api";

    // CelesTrak updates GP data about every 2 hours; downloading more often gets the IP firewalled.
    private static final long CELESTRAK_REFRESH_MS = 2 * 3600_000L;
    // The TLE API fallback is a small shared host and a large group takes many requests, so refresh it less often.
    private static final long TLE_API_REFRESH_MS = 6 * 3600_000L;
    // An incomplete download (upstream failed partway) is retried sooner.
    private static final long INCOMPLETE_RETRY_MS = 10 * 60_000L;
    private static final int LOADER_THREADS = 3;

    /** Valid CelesTrak group names. */
    public static final Set<String> CELESTRAK_GROUPS = Set.of(
            "STATIONS", "STARLINK", "ONEWEB", "GPS-OPS", "GLO-OPS",
            "GALILEO", "BEIDOU", "INTELSAT", "SES", "IRIDIUM",
            "IRIDIUM-NEXT", "ORBCOMM", "GLOBALSTAR", "AMATEUR",
            "NOAA", "GOES", "RESOURCE", "SARSAT", "GEO", "ACTIVE"
    );

    /** TLE API search terms used when CelesTrak can't serve a group. */
    private static final Map<String, String> GROUP_SEARCH_TERMS = Map.ofEntries(
            Map.entry("STARLINK", "starlink"),
            Map.entry("ONEWEB", "oneweb"),
            Map.entry("GPS-OPS", "GPS"),
            Map.entry("GLO-OPS", "GLONASS"),
            Map.entry("GALILEO", "GALILEO"),
            Map.entry("BEIDOU", "BEIDOU"),
            Map.entry("INTELSAT", "INTELSAT"),
            Map.entry("SES", "SES"),
            Map.entry("IRIDIUM", "IRIDIUM"),
            Map.entry("IRIDIUM-NEXT", "IRIDIUM"),
            Map.entry("ORBCOMM", "ORBCOMM"),
            Map.entry("GLOBALSTAR", "GLOBALSTAR"),
            Map.entry("AMATEUR", "AMATEUR"),
            Map.entry("NOAA", "NOAA"),
            Map.entry("GOES", "GOES"),
            Map.entry("STATIONS", "STATION"),
            Map.entry("GEO", "GEO"),
            Map.entry("ACTIVE", "")
    );

    /** Loaded at startup so the default views are ready before anyone asks. */
    private static final List<String> PRELOAD_KEYS = List.of(groupKey("STATIONS"), groupKey("STARLINK"));

    /**
     * One catalog entry. complete=false means the download is still running or stopped partway;
     * the satellites list is whatever has arrived so far.
     */
    public record Snapshot(List<CelestrakSatelliteDto> satellites, String source, long updatedAt, boolean complete) {}

    private final CelestrakApiClient celestrakApiClient;
    private final TleApiClient tleApiClient;

    private final Map<String, Snapshot> entries = new ConcurrentHashMap<>();
    private final Map<Integer, CelestrakSatelliteDto> byId = new ConcurrentHashMap<>();
    private final Set<String> loading = ConcurrentHashMap.newKeySet();
    private final ExecutorService loader = Executors.newFixedThreadPool(LOADER_THREADS, daemonThreads());

    @Value("${lune.catalog.cache-dir:${user.home}/.lune/tle-cache}")
    private Path cacheDir;

    public SatelliteCatalog(CelestrakApiClient celestrakApiClient, TleApiClient tleApiClient) {
        this.celestrakApiClient = celestrakApiClient;
        this.tleApiClient = tleApiClient;
    }

    public static String groupKey(String group) {
        return "GROUP:" + group.toUpperCase(Locale.ROOT);
    }

    public static String nameKey(String name) {
        return "NAME:" + name.toUpperCase(Locale.ROOT);
    }

    public static String idsKey(List<Integer> ids) {
        return "IDS:" + String.join(",", ids.stream().map(String::valueOf).toList());
    }

    @PostConstruct
    void init() {
        loadFromDisk();
        PRELOAD_KEYS.forEach(this::get);
        refreshStale();
    }

    @PreDestroy
    void shutdown() {
        // Devtools restarts create a new context; don't leave old loaders running against stale beans.
        loader.shutdownNow();
    }

    /**
     * Current snapshot for a key, or null if it has never been loaded. Never blocks on the network:
     * a missing or stale entry is queued for a background load and the caller gets what's in memory now.
     */
    public Snapshot get(String key) {
        Snapshot snapshot = entries.get(key);
        if (snapshot == null || isStale(snapshot)) {
            queueLoad(key);
        }
        return snapshot;
    }

    public boolean isLoading(String key) {
        return loading.contains(key);
    }

    public Optional<CelestrakSatelliteDto> findById(int noradId) {
        return Optional.ofNullable(byId.get(noradId));
    }

    /** Name search over every satellite already in memory (no network). */
    public List<CelestrakSatelliteDto> searchLoaded(String text, int limit) {
        String needle = text.toUpperCase(Locale.ROOT);
        return byId.values().stream()
                .filter(s -> s.getName() != null && s.getName().toUpperCase(Locale.ROOT).contains(needle))
                .limit(limit)
                .toList();
    }

    @Scheduled(initialDelay = 10 * 60_000L, fixedDelay = 10 * 60_000L)
    void refreshStale() {
        entries.forEach((key, snapshot) -> {
            if (isStale(snapshot)) {
                queueLoad(key);
            }
        });
    }

    private static boolean isStale(Snapshot snapshot) {
        long age = System.currentTimeMillis() - snapshot.updatedAt();
        if (!snapshot.complete()) {
            return age > INCOMPLETE_RETRY_MS;
        }
        return age > (SOURCE_CELESTRAK.equals(snapshot.source()) ? CELESTRAK_REFRESH_MS : TLE_API_REFRESH_MS);
    }

    private void queueLoad(String key) {
        if (!loading.add(key)) {
            return;
        }
        try {
            loader.submit(() -> {
                try {
                    load(key);
                } catch (Exception e) {
                    log.warn("Catalog load for {} failed: {}", key, e.getMessage());
                } finally {
                    loading.remove(key);
                }
            });
        } catch (RuntimeException e) {
            loading.remove(key); // executor shut down during a restart
        }
    }

    private void load(String key) {
        long started = System.currentTimeMillis();
        int sep = key.indexOf(':');
        String kind = sep > 0 ? key.substring(0, sep) : "";
        String value = sep > 0 ? key.substring(sep + 1) : key;

        if ("IDS".equals(kind)) {
            loadIds(key, parseIds(value));
            return;
        }
        List<CelestrakSatelliteDto> fromCelestrak = switch (kind) {
            case "GROUP" -> celestrakApiClient.fetchGroup(value);
            case "NAME" -> celestrakApiClient.fetchByName(value);
            default -> throw new IllegalArgumentException("Unknown catalog key " + key);
        };
        if (!fromCelestrak.isEmpty()) {
            publish(key, new Snapshot(fromCelestrak, SOURCE_CELESTRAK, System.currentTimeMillis(), true), true);
            log.info("Catalog {}: {} satellites from CelesTrak in {} ms", key, fromCelestrak.size(), System.currentTimeMillis() - started);
            return;
        }

        String search = "GROUP".equals(kind) ? GROUP_SEARCH_TERMS.getOrDefault(value, value) : value;
        log.info("Catalog {}: CelesTrak unavailable, downloading from TLE API (search '{}')", key, search);
        Snapshot previous = entries.get(key);
        boolean keepPrevious = previous != null && previous.complete();
        TleApiClient.BulkResult result = tleApiClient.fetchAll(search, progress -> {
            // Show satellites as pages arrive the first time; a refresh keeps serving the old complete copy.
            if (!keepPrevious) {
                publish(key, new Snapshot(progress.stream().map(SatelliteCatalog::toDto).toList(),
                        SOURCE_TLE_API, System.currentTimeMillis(), false), false);
            }
        });
        List<CelestrakSatelliteDto> items = result.items().stream().map(SatelliteCatalog::toDto).toList();
        if (result.complete() && !items.isEmpty()) {
            publish(key, new Snapshot(items, SOURCE_TLE_API, System.currentTimeMillis(), true), true);
            log.info("Catalog {}: {} satellites from TLE API in {} s", key, items.size(), (System.currentTimeMillis() - started) / 1000);
        } else if (result.complete()) {
            // The search worked but matched nothing: a real answer, so check again at the normal interval, not every 10 min.
            entries.put(key, new Snapshot(List.of(), SOURCE_TLE_API, System.currentTimeMillis(), true));
            log.info("Catalog {}: TLE API has no satellites matching '{}'", key, search);
        } else if (keepPrevious) {
            // Keep the old copy but retry after the short incomplete-retry delay.
            entries.put(key, new Snapshot(previous.satellites(), previous.source(),
                    System.currentTimeMillis() - TLE_API_REFRESH_MS + INCOMPLETE_RETRY_MS, true));
        } else if (items.isEmpty()) {
            markFailed(key);
        }
        // Otherwise a partial list is already published (complete=false) and is retried after INCOMPLETE_RETRY_MS.
    }

    /** Specific satellites, each from CelesTrak or else the TLE API. Missing any means incomplete, so it's retried soon. */
    private void loadIds(String key, List<Integer> ids) {
        List<CelestrakSatelliteDto> found = new ArrayList<>();
        boolean allFromCelestrak = true;
        for (int id : ids) {
            Optional<CelestrakSatelliteDto> tle = celestrakApiClient.fetchSatellite(id);
            if (tle.isEmpty()) {
                allFromCelestrak = false;
                tle = tleApiClient.getTle(id)
                        .filter(t -> t.getLine1() != null && t.getLine2() != null)
                        .map(SatelliteCatalog::toDto);
            }
            tle.ifPresent(found::add);
        }
        if (found.isEmpty()) {
            markFailed(key);
            return;
        }
        boolean complete = found.size() == ids.size();
        if (!complete) {
            log.info("Catalog {}: found {} of {} satellites, retrying the rest in {} min", key, found.size(), ids.size(), INCOMPLETE_RETRY_MS / 60_000);
        }
        publish(key, new Snapshot(found, allFromCelestrak ? SOURCE_CELESTRAK : SOURCE_TLE_API, System.currentTimeMillis(), complete), true);
    }

    /** Nothing could be downloaded: remember that, so requests don't re-trigger it until the retry delay passes. */
    private void markFailed(String key) {
        log.warn("Catalog {}: no satellites from any source, retrying in {} min", key, INCOMPLETE_RETRY_MS / 60_000);
        entries.merge(key, new Snapshot(List.of(), SOURCE_TLE_API, System.currentTimeMillis(), false),
                (old, failed) -> old.satellites().isEmpty() ? failed : old);
    }

    private void publish(String key, Snapshot snapshot, boolean persist) {
        entries.put(key, snapshot);
        for (CelestrakSatelliteDto s : snapshot.satellites()) {
            byId.put(s.getNoradCatId(), s);
        }
        if (persist) {
            writeToDisk(key, snapshot);
        }
    }

    private static List<Integer> parseIds(String value) {
        return Arrays.stream(value.split(",")).map(String::trim).map(Integer::parseInt).toList();
    }

    private static CelestrakSatelliteDto toDto(TleDto tle) {
        CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
        dto.setNoradCatId(tle.getSatelliteId());
        dto.setName(tle.getName());
        dto.setLine1(tle.getLine1());
        dto.setLine2(tle.getLine2());
        return dto;
    }

    // ── Disk cache: one 3LE file per key with a "# key=... source=..." header; mtime is the download time ──

    private Path fileFor(String key) {
        return cacheDir.resolve(key.replaceAll("[^A-Za-z0-9_-]", "_") + ".3le");
    }

    private void writeToDisk(String key, Snapshot snapshot) {
        Path file = fileFor(key);
        try {
            Files.createDirectories(cacheDir);
            Path tmp = Files.createTempFile(cacheDir, "catalog", ".tmp");
            Files.writeString(tmp, "# key=" + key + " source=" + snapshot.source() + "\n"
                    + CelestrakApiClient.format3le(snapshot.satellites()), StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            log.warn("Could not write catalog cache {}: {}", file, e.getMessage());
        }
    }

    private void loadFromDisk() {
        if (!Files.isDirectory(cacheDir)) {
            return;
        }
        try (DirectoryStream<Path> files = Files.newDirectoryStream(cacheDir, "*.3le")) {
            for (Path file : files) {
                String text = Files.readString(file, StandardCharsets.UTF_8);
                String header = text.lines().findFirst().orElse("");
                String key = headerValue(header, "key");
                String source = headerValue(header, "source");
                List<CelestrakSatelliteDto> satellites = CelestrakApiClient.parse3le(text);
                if (key == null || satellites.isEmpty()) {
                    continue;
                }
                long updatedAt = Files.getLastModifiedTime(file).toMillis();
                // An ID list saved with some satellites missing is retried soon instead of at the normal interval.
                boolean complete = !key.startsWith("IDS:") || satellites.size() == parseIds(key.substring(4)).size();
                publish(key, new Snapshot(satellites, source != null ? source : SOURCE_CELESTRAK, updatedAt, complete), false);
                log.info("Catalog {}: {} satellites from disk (downloaded {})", key, satellites.size(), Instant.ofEpochMilli(updatedAt));
            }
        } catch (IOException e) {
            log.warn("Could not read catalog cache {}: {}", cacheDir, e.getMessage());
        }
    }

    private static String headerValue(String header, String name) {
        if (!header.startsWith("#")) {
            return null;
        }
        for (String part : header.substring(1).trim().split("\\s+")) {
            if (part.startsWith(name + "=")) {
                return part.substring(name.length() + 1);
            }
        }
        return null;
    }

    private static java.util.concurrent.ThreadFactory daemonThreads() {
        AtomicInteger n = new AtomicInteger();
        return r -> {
            Thread t = new Thread(r, "catalog-loader-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
    }
}
