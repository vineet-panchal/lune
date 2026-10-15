package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.CartesianDto;
import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import com.lune.backend.satellite.dto.GeodeticDto;
import com.lune.backend.satellite.dto.PropagationResultDto;
import com.lune.backend.satellite.dto.SatelliteListItemDto;
import com.lune.backend.satellite.dto.SatelliteListResponseDto;
import com.lune.backend.satellite.dto.SatellitePositionDto;
import com.lune.backend.satellite.dto.SatelliteTrailDto;
import com.lune.backend.satellite.dto.TrailPointDto;
import com.lune.backend.satellite.dto.TleDto;
import com.lune.backend.satellite.dto.TleListResponseDto;
import com.lune.backend.satellite.dto.VectorDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class SatelliteService {

    private static final DateTimeFormatter ISO_FORMAT = DateTimeFormatter.ISO_INSTANT;
    private static final int DEFAULT_TRAIL_POINTS_EACH_SIDE = 5;
    private static final double MIN_SPEED_KM_S = 2.0; // avoid div by zero for very slow objects
    private static final long TLE_CACHE_TTL_MS = 3600_000; // cache TLE data for 1 hour
    private static final int SEARCH_RESULT_LIMIT = 100;
    /** An ID list this short may download satellites that aren't in memory, one request each. */
    private static final int MAX_ID_LOOKUPS = 10;

    /** Catalog keys merged for the "Internet" type. */
    private static final List<String> INTERNET_KEYS = List.of(
            SatelliteCatalog.groupKey("STARLINK"),
            SatelliteCatalog.groupKey("ONEWEB"),
            SatelliteCatalog.nameKey("KUIPER"),
            SatelliteCatalog.nameKey("QIANFAN"),
            SatelliteCatalog.nameKey("GUOWANG"),
            SatelliteCatalog.nameKey("GALAXYSPACE"),
            SatelliteCatalog.nameKey("E-SPACE")
    );

    private static final Map<String, String> CUSTOM_TYPE_SEARCH_TERMS = Map.ofEntries(
            Map.entry("KUIPER", "KUIPER"),
            Map.entry("QIANFAN", "QIANFAN"),
            Map.entry("GUOWANG", "GUOWANG"),
            Map.entry("GALAXYSPACE", "GALAXYSPACE"),
            Map.entry("E-SPACE", "E-SPACE"),
            Map.entry("ESPACE", "E-SPACE"),
            Map.entry("LEO", "KUIPER")
    );

    /** Company filters the UI sends as a name search; these are cached in the catalog like groups. */
    private static final Set<String> CATALOG_NAME_FILTERS = Set.of(
            "KUIPER", "QIANFAN", "GUOWANG", "GALAXYSPACE", "E-SPACE", "BLUEWALKER", "LYNK",
            "PLANET", "JILIN", "SATELOG", "SPIRE", "SWARM", "GEESPACE", "TIANQI"
    );

    /** Curated "popular" satellites, with display names. */
    private static final List<SatelliteListItemDto> POPULAR_SATELLITES = List.of(
            item(25544, "ISS (ZARYA)"),
            item(20580, "HST (Hubble)"),
            item(48274, "CSS (TIANHE)"),
            item(25338, "NOAA 15"),
            item(28654, "NOAA 18"),
            item(33591, "NOAA 19"),
            item(49260, "LANDSAT 9")
    );
    private static final String POPULAR_KEY = SatelliteCatalog.idsKey(
            POPULAR_SATELLITES.stream().map(SatelliteListItemDto::getSatelliteId).toList());

    private static SatelliteListItemDto item(int id, String name) {
        return SatelliteListItemDto.builder().satelliteId(id).name(name).tleDate(null).build();
    }

    private final TleApiClient tleApiClient;
    private final CelestrakApiClient celestrakApiClient;
    private final Sgp4Propagator sgp4Propagator;
    private final SatelliteCatalog catalog;

    /** Single satellites looked up outside the catalog (e.g. a search result that was clicked), keyed by NORAD ID. */
    private record CachedTle(CelestrakSatelliteDto tle, long fetchedAt) {}
    private final Map<Integer, CachedTle> tleCache = new ConcurrentHashMap<>();

    /**
     * Get TLE for a satellite: in-memory catalog first, then a one-off CelesTrak / TLE API lookup (cached 1h).
     */
    private Optional<CelestrakSatelliteDto> getCachedTle(int satelliteId) {
        Optional<CelestrakSatelliteDto> fromCatalog = catalog.findById(satelliteId);
        if (fromCatalog.isPresent()) {
            return fromCatalog;
        }
        CachedTle cached = tleCache.get(satelliteId);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < TLE_CACHE_TTL_MS) {
            return Optional.of(cached.tle());
        }
        Optional<CelestrakSatelliteDto> opt = celestrakApiClient.fetchSatellite(satelliteId);
        if (opt.isPresent()) {
            tleCache.put(satelliteId, new CachedTle(opt.get(), System.currentTimeMillis()));
            return opt;
        }
        // Fallback: convert TLE API result to CelestrakSatelliteDto so local SGP4 works
        Optional<TleDto> tleOpt = tleApiClient.getTle(satelliteId);
        if (tleOpt.isPresent()) {
            TleDto tle = tleOpt.get();
            if (tle.getLine1() != null && tle.getLine2() != null) {
                CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
                dto.setNoradCatId(tle.getSatelliteId());
                dto.setName(tle.getName());
                dto.setLine1(tle.getLine1());
                dto.setLine2(tle.getLine2());
                tleCache.put(satelliteId, new CachedTle(dto, System.currentTimeMillis()));
                return Optional.of(dto);
            }
        }
        return Optional.empty();
    }

    /**
     * List satellites with TLEs for client-side propagation. Every filter is served from the in-memory
     * catalog without waiting on an upstream; loading=true means the catalog is still downloading
     * and the client should poll again.
     */
    public SatelliteListResponseDto getSatellites(int page, int pageSize, String search, String sort, String group, String type) {
        if ("popular".equalsIgnoreCase(group != null ? group.strip() : null)) {
            return getPopular(page, pageSize);
        }

        String upperType = type != null && !type.isBlank() ? type.strip().toUpperCase(Locale.ROOT) : null;
        if ("INTERNET".equals(upperType)) {
            return fromCatalog(INTERNET_KEYS, "INTERNET", page, pageSize, sort);
        }
        if (upperType != null && CUSTOM_TYPE_SEARCH_TERMS.containsKey(upperType)) {
            return fromCatalog(List.of(SatelliteCatalog.nameKey(CUSTOM_TYPE_SEARCH_TERMS.get(upperType))), upperType, page, pageSize, sort);
        }
        if (upperType != null && SatelliteCatalog.CELESTRAK_GROUPS.contains(upperType)) {
            return fromCatalog(List.of(SatelliteCatalog.groupKey(upperType)), upperType, page, pageSize, sort);
        }

        String term = search != null ? search.strip() : "";
        if (!term.isEmpty() && CATALOG_NAME_FILTERS.contains(term.toUpperCase(Locale.ROOT))) {
            return fromCatalog(List.of(SatelliteCatalog.nameKey(term)), type, page, pageSize, sort);
        }
        if (!term.isEmpty()) {
            // Free-text search box: answer from memory when possible, otherwise ask the TLE API directly.
            List<CelestrakSatelliteDto> loaded = catalog.searchLoaded(term, SEARCH_RESULT_LIMIT);
            if (!loaded.isEmpty()) {
                List<SatelliteListItemDto> items = sortItems(loaded.stream().map(s -> toItem(s, type)).toList(), sort);
                return paginate(page, pageSize, items, SatelliteCatalog.SOURCE_CELESTRAK, null, false);
            }
        }
        return searchTleApi(page, pageSize, term, sort, type);
    }

    /**
     * Exactly these satellites, from memory (any loaded group can supply them). A short list may also look up the
     * ones that aren't loaded; a long one (a whole launch) is only ever answered from memory.
     */
    public SatelliteListResponseDto getSatellitesByIds(int page, int pageSize, List<Integer> ids) {
        boolean lookUpMissing = ids.size() <= MAX_ID_LOOKUPS;
        List<SatelliteListItemDto> items = new ArrayList<>();
        for (int id : new LinkedHashSet<>(ids)) {
            Optional<CelestrakSatelliteDto> tle = lookUpMissing ? getCachedTle(id) : catalog.findById(id);
            tle.ifPresent(t -> items.add(toItem(t, null)));
        }
        // Gathered from whichever groups hold them, so there's no single source to name.
        return paginate(page, pageSize, items, null, null, false);
    }

    private SatelliteListResponseDto getPopular(int page, int pageSize) {
        SatelliteCatalog.Snapshot snapshot = catalog.get(POPULAR_KEY);
        List<SatelliteListItemDto> items = new ArrayList<>();
        for (SatelliteListItemDto popular : POPULAR_SATELLITES) {
            // Prefer the curated set's own download, but any loaded group (e.g. STATIONS) can supply the TLE.
            Optional<CelestrakSatelliteDto> tle = snapshot != null
                    ? snapshot.satellites().stream().filter(s -> s.getNoradCatId().equals(popular.getSatelliteId())).findFirst()
                    : Optional.empty();
            if (tle.isEmpty()) {
                tle = catalog.findById(popular.getSatelliteId());
            }
            tle.ifPresent(t -> items.add(SatelliteListItemDto.builder()
                    .satelliteId(popular.getSatelliteId())
                    .name(popular.getName())
                    .line1(t.getLine1())
                    .line2(t.getLine2())
                    .build()));
        }
        boolean loading = items.size() < POPULAR_SATELLITES.size() && catalog.isLoading(POPULAR_KEY);
        String source = snapshot != null ? snapshot.source() : SatelliteCatalog.SOURCE_CELESTRAK;
        SatelliteListResponseDto resp = paginate(page, pageSize, items, source, snapshot != null ? snapshot.updatedAt() : null, loading);
        resp.setTotalItems(Math.max(items.size(), loading ? POPULAR_SATELLITES.size() : items.size()));
        return resp;
    }

    private SatelliteListResponseDto fromCatalog(List<String> keys, String typeLabel, int page, int pageSize, String sort) {
        Map<Integer, SatelliteListItemDto> merged = new LinkedHashMap<>();
        boolean loading = false;
        Long oldestUpdate = null;
        Set<String> sources = new LinkedHashSet<>();
        for (String key : keys) {
            SatelliteCatalog.Snapshot snapshot = catalog.get(key);
            if (snapshot == null || !snapshot.complete()) {
                loading |= snapshot == null || catalog.isLoading(key);
            }
            if (snapshot == null) {
                continue;
            }
            sources.add(snapshot.source());
            oldestUpdate = oldestUpdate == null ? snapshot.updatedAt() : Math.min(oldestUpdate, snapshot.updatedAt());
            for (CelestrakSatelliteDto s : snapshot.satellites()) {
                merged.putIfAbsent(s.getNoradCatId(), toItem(s, typeLabel));
            }
        }
        String source = sources.isEmpty() ? null : String.join("+", sources);
        return paginate(page, pageSize, sortItems(List.copyOf(merged.values()), sort), source, oldestUpdate, loading);
    }

    private SatelliteListResponseDto searchTleApi(int page, int pageSize, String search, String sort, String type) {
        TleListResponseDto raw = tleApiClient.getTleList(page, pageSize, search.isEmpty() ? null : search, sort);
        List<SatelliteListItemDto> items = raw == null || raw.getMember() == null ? List.of() : raw.getMember().stream()
                .map(tle -> SatelliteListItemDto.builder()
                        .satelliteId(tle.getSatelliteId())
                        .name(tle.getName())
                        .tleDate(tle.getDate())
                        .type(type)
                        .line1(tle.getLine1())
                        .line2(tle.getLine2())
                        .build())
                .toList();
        return SatelliteListResponseDto.builder()
                .satellites(items)
                .totalItems(items.size())
                .page(page)
                .pageSize(pageSize)
                .dataSource(SatelliteCatalog.SOURCE_TLE_API)
                .build();
    }

    private static SatelliteListItemDto toItem(CelestrakSatelliteDto s, String type) {
        return SatelliteListItemDto.builder()
                .satelliteId(s.getNoradCatId())
                .name(s.getName())
                .tleDate(null)
                .type(type)
                .line1(s.getLine1())
                .line2(s.getLine2())
                .build();
    }

    private List<SatelliteListItemDto> sortItems(List<SatelliteListItemDto> items, String sort) {
        if (sort == null || !"name".equalsIgnoreCase(sort.strip())) {
            return items;
        }
        return items.stream()
                .sorted(Comparator.comparing(
                        i -> i.getName() != null ? i.getName().toLowerCase() : "",
                        Comparator.naturalOrder()))
                .toList();
    }

    private SatelliteListResponseDto paginate(int page, int pageSize, List<SatelliteListItemDto> items,
                                              String dataSource, Long tleUpdatedAt, boolean loading) {
        int total = items.size();
        int from = Math.min((page - 1) * pageSize, total);
        int to = Math.min(from + pageSize, total);
        return SatelliteListResponseDto.builder()
                .satellites(from < to ? items.subList(from, to) : List.of())
                .totalItems(total)
                .page(page)
                .pageSize(pageSize)
                .dataSource(dataSource)
                .tleUpdatedAt(tleUpdatedAt != null ? ISO_FORMAT.format(Instant.ofEpochMilli(tleUpdatedAt)) : null)
                .loading(loading)
                .build();
    }

    public Optional<TleDto> getSatellite(int satelliteId) {
        // Try CelesTrak first (no strict rate limit)
        Optional<CelestrakSatelliteDto> celestrak = getCachedTle(satelliteId);
        if (celestrak.isPresent()) {
            CelestrakSatelliteDto c = celestrak.get();
            TleDto dto = new TleDto();
            dto.setSatelliteId(c.getNoradCatId());
            dto.setName(c.getName());
            dto.setLine1(c.getLine1());
            dto.setLine2(c.getLine2());
            return Optional.of(dto);
        }
        // Fallback: tle.ivanstanojevic.me (may be rate-limited)
        return tleApiClient.getTle(satelliteId);
    }

    public Optional<SatellitePositionDto> getPosition(int satelliteId, Instant instant) {
        // Primary: local SGP4 propagation using CelesTrak TLE (no rate limits)
        Optional<CelestrakSatelliteDto> tleOpt = getCachedTle(satelliteId);
        if (tleOpt.isPresent()) {
            CelestrakSatelliteDto tle = tleOpt.get();
            Optional<PropagationResultDto> result = sgp4Propagator.propagate(
                    tle.getName(), satelliteId, tle.getLine1(), tle.getLine2(), instant);
            if (result.isPresent()) {
                return result.map(r -> toPositionDto(r, instant));
            }
        }
        // Fallback: external TLE API (may be rate-limited)
        return tleApiClient.propagate(satelliteId, instant)
                .map(r -> toPositionDto(r, instant));
    }

    /**
     * Get current position plus trail points (past and future) for orbit trail visualization.
     * trailKm: approximate distance in km each direction (default 30).
     * Uses local SGP4 propagation — no external API call per trail point.
     */
    public Optional<SatelliteTrailDto> getTrail(int satelliteId, Instant instant, double trailKm) {
        // Try local SGP4 first
        Optional<CelestrakSatelliteDto> tleOpt = getCachedTle(satelliteId);
        if (tleOpt.isPresent()) {
            return getTrailLocal(tleOpt.get(), satelliteId, instant, trailKm);
        }
        // Fallback: external API
        return getTrailExternal(satelliteId, instant, trailKm);
    }

    private Optional<SatelliteTrailDto> getTrailLocal(CelestrakSatelliteDto tle, int satelliteId, Instant instant, double trailKm) {
        Optional<PropagationResultDto> currentOpt = sgp4Propagator.propagate(
                tle.getName(), satelliteId, tle.getLine1(), tle.getLine2(), instant);
        if (currentOpt.isEmpty()) return Optional.empty();

        SatellitePositionDto currentPos = toPositionDto(currentOpt.get(), instant);
        double speedKmPerSec = Math.max(currentPos.getSpeedKmPerSec(), MIN_SPEED_KM_S);
        double timeSpanSec = trailKm / speedKmPerSec;
        int pointsEachSide = Math.min(DEFAULT_TRAIL_POINTS_EACH_SIDE, 15);
        double stepSec = timeSpanSec / pointsEachSide;

        List<TrailPointDto> trail = new ArrayList<>();
        for (int i = pointsEachSide; i >= 1; i--) {
            Instant t = instant.minusSeconds((long) (i * stepSec));
            sgp4Propagator.propagate(tle.getName(), satelliteId, tle.getLine1(), tle.getLine2(), t)
                    .map(PropagationResultDto::getVector)
                    .map(VectorDto::getPosition)
                    .ifPresent(p -> trail.add(TrailPointDto.builder()
                            .datetime(ISO_FORMAT.format(t)).x(p.getX()).y(p.getY()).z(p.getZ()).build()));
        }
        trail.add(TrailPointDto.builder()
                .datetime(ISO_FORMAT.format(instant))
                .x(currentPos.getPositionX()).y(currentPos.getPositionY()).z(currentPos.getPositionZ()).build());
        for (int i = 1; i <= pointsEachSide; i++) {
            Instant t = instant.plusSeconds((long) (i * stepSec));
            sgp4Propagator.propagate(tle.getName(), satelliteId, tle.getLine1(), tle.getLine2(), t)
                    .map(PropagationResultDto::getVector)
                    .map(VectorDto::getPosition)
                    .ifPresent(p -> trail.add(TrailPointDto.builder()
                            .datetime(ISO_FORMAT.format(t)).x(p.getX()).y(p.getY()).z(p.getZ()).build()));
        }

        return Optional.of(SatelliteTrailDto.builder()
                .satelliteId(satelliteId).name(currentPos.getName())
                .current(currentPos).trail(trail).build());
    }

    private Optional<SatelliteTrailDto> getTrailExternal(int satelliteId, Instant instant, double trailKm) {
        Optional<PropagationResultDto> currentOpt = tleApiClient.propagate(satelliteId, instant);
        if (currentOpt.isEmpty()) return Optional.empty();

        PropagationResultDto current = currentOpt.get();
        SatellitePositionDto currentPos = toPositionDto(current, instant);
        double speedKmPerSec = currentPos.getSpeedKmPerSec();
        if (speedKmPerSec < MIN_SPEED_KM_S) speedKmPerSec = MIN_SPEED_KM_S;

        double timeSpanSec = trailKm / speedKmPerSec;
        int pointsEachSide = Math.min(DEFAULT_TRAIL_POINTS_EACH_SIDE, 15);
        double stepSec = timeSpanSec / pointsEachSide;

        List<TrailPointDto> trail = new ArrayList<>();

        // Past points (then current, then future)
        for (int i = pointsEachSide; i >= 1; i--) {
            Instant t = instant.minusSeconds((long) (i * stepSec));
            tleApiClient.propagate(satelliteId, t)
                    .map(PropagationResultDto::getVector)
                    .map(VectorDto::getPosition)
                    .ifPresent(p -> trail.add(TrailPointDto.builder()
                            .datetime(ISO_FORMAT.format(t))
                            .x(p.getX())
                            .y(p.getY())
                            .z(p.getZ())
                            .build()));
        }
        trail.add(TrailPointDto.builder()
                .datetime(ISO_FORMAT.format(instant))
                .x(currentPos.getPositionX())
                .y(currentPos.getPositionY())
                .z(currentPos.getPositionZ())
                .build());
        for (int i = 1; i <= pointsEachSide; i++) {
            Instant t = instant.plusSeconds((long) (i * stepSec));
            tleApiClient.propagate(satelliteId, t)
                    .map(PropagationResultDto::getVector)
                    .map(VectorDto::getPosition)
                    .ifPresent(p -> trail.add(TrailPointDto.builder()
                            .datetime(ISO_FORMAT.format(t))
                            .x(p.getX())
                            .y(p.getY())
                            .z(p.getZ())
                            .build()));
        }

        return Optional.of(SatelliteTrailDto.builder()
                .satelliteId(satelliteId)
                .name(currentPos.getName())
                .current(currentPos)
                .trail(trail)
                .build());
    }

    private SatellitePositionDto toPositionDto(PropagationResultDto r, Instant instant) {
        TleDto tle = r.getTle();
        GeodeticDto geo = r.getGeodetic();
        VectorDto vec = r.getVector();
        CartesianDto pos = vec != null ? vec.getPosition() : null;
        CartesianDto vel = vec != null ? vec.getVelocity() : null;

        double vx = vel != null && vel.getX() != null ? vel.getX() : 0;
        double vy = vel != null && vel.getY() != null ? vel.getY() : 0;
        double vz = vel != null && vel.getZ() != null ? vel.getZ() : 0;
        double speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

        return SatellitePositionDto.builder()
                .satelliteId(tle != null ? tle.getSatelliteId() : null)
                .name(tle != null ? tle.getName() : null)
                .datetime(instant != null ? ISO_FORMAT.format(instant) : null)
                .positionX(pos != null && pos.getX() != null ? pos.getX() : 0)
                .positionY(pos != null && pos.getY() != null ? pos.getY() : 0)
                .positionZ(pos != null && pos.getZ() != null ? pos.getZ() : 0)
                .latitude(geo != null && geo.getLatitude() != null ? geo.getLatitude() : 0)
                .longitude(geo != null && geo.getLongitude() != null ? geo.getLongitude() : 0)
                .altitudeKm(geo != null && geo.getAltitude() != null ? geo.getAltitude() : 0)
                .velocityX(vx)
                .velocityY(vy)
                .velocityZ(vz)
                .speedKmPerSec(speed)
                .build();
    }
}
