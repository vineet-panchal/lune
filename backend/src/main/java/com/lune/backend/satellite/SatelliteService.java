package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.*;
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

    /** Curated "popular" satellites – no external list call, fast response. */
    private static final List<SatelliteListItemDto> POPULAR_SATELLITES = List.of(
            item(25544, "ISS (ZARYA)"),
            item(20580, "HST (Hubble)"),
            item(48274, "CSS (TIANHE)"),
            item(25338, "NOAA 15"),
            item(28654, "NOAA 18"),
            item(33591, "NOAA 19"),
            item(49260, "LANDSAT 9")
    );

    /** Valid CelesTrak group names — these bypass tle.ivanstanojevic.me and use CelesTrak directly. */
    private static final Set<String> CELESTRAK_GROUPS = Set.of(
            "STATIONS", "STARLINK", "ONEWEB", "GPS-OPS", "GLO-OPS",
            "GALILEO", "BEIDOU", "INTELSAT", "SES", "IRIDIUM",
            "IRIDIUM-NEXT", "ORBCOMM", "GLOBALSTAR", "AMATEUR",
            "NOAA", "GOES", "RESOURCE", "SARSAT", "GEO", "ACTIVE"
    );

    /** Maps CelesTrak group names to search terms for fallback TLE API queries. */
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

    private static SatelliteListItemDto item(int id, String name) {
        return SatelliteListItemDto.builder().satelliteId(id).name(name).tleDate(null).build();
    }

    private final TleApiClient tleApiClient;
    private final CelestrakApiClient celestrakApiClient;
    private final Sgp4Propagator sgp4Propagator;

    /** Cache of TLE data fetched from CelesTrak, keyed by NORAD ID. */
    private record CachedTle(CelestrakSatelliteDto tle, long fetchedAt) {}
    private final Map<Integer, CachedTle> tleCache = new ConcurrentHashMap<>();

    /**
     * Get TLE for a satellite — uses in-memory cache (1h TTL) backed by CelesTrak, with TLE API fallback.
     */
    private Optional<CelestrakSatelliteDto> getCachedTle(int satelliteId) {
        CachedTle cached = tleCache.get(satelliteId);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < TLE_CACHE_TTL_MS) {
            return Optional.of(cached.tle());
        }
        // Try CelesTrak first
        Optional<CelestrakSatelliteDto> opt = celestrakApiClient.getSatellite(satelliteId);
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

    public SatelliteListResponseDto getSatellites(int page, int pageSize, String search, String sort, String group, String type) {
        // popular group — fast curated list, enrich with TLE data for client-side propagation
        if ("popular".equalsIgnoreCase(group != null ? group.strip() : null)) {
            int total = POPULAR_SATELLITES.size();
            int from = Math.min((page - 1) * pageSize, total);
            int to = Math.min(from + pageSize, total);
            List<SatelliteListItemDto> pageItems = from < to
                    ? POPULAR_SATELLITES.subList(from, to).stream()
                        .map(item -> {
                            Optional<CelestrakSatelliteDto> tle = getCachedTle(item.getSatelliteId());
                            if (tle.isPresent()) {
                                return SatelliteListItemDto.builder()
                                        .satelliteId(item.getSatelliteId())
                                        .name(item.getName())
                                        .tleDate(item.getTleDate())
                                        .type(item.getType())
                                        .line1(tle.get().getLine1())
                                        .line2(tle.get().getLine2())
                                        .build();
                            }
                            return item;
                        })
                        .toList()
                    : List.of();
            return SatelliteListResponseDto.builder()
                    .satellites(pageItems)
                    .totalItems(total)
                    .page(page)
                    .pageSize(pageSize)
                    .dataSource("celestrak")
                    .build();
        }

        // CelesTrak group — fetch by category, with fallback to TLE API search
        String celestrakGroup = type != null ? type.strip().toUpperCase() : null;
        if (celestrakGroup != null && CELESTRAK_GROUPS.contains(celestrakGroup)) {
            List<CelestrakSatelliteDto> raw = celestrakApiClient.getGroup(celestrakGroup);
            if (!raw.isEmpty()) {
                // Pre-populate TLE cache so batch position requests don't hit CelesTrak per-satellite
                long now = System.currentTimeMillis();
                for (CelestrakSatelliteDto s : raw) {
                    if (s.getNoradCatId() != null && s.getLine1() != null && s.getLine2() != null) {
                        tleCache.putIfAbsent(s.getNoradCatId(), new CachedTle(s, now));
                    }
                }
                int total = raw.size();
                int from = Math.min((page - 1) * pageSize, total);
                int to = Math.min(from + pageSize, total);
                List<SatelliteListItemDto> items = raw.subList(from, to).stream()
                        .filter(s -> s.getNoradCatId() != null)
                        .map(s -> SatelliteListItemDto.builder()
                                .satelliteId(s.getNoradCatId())
                                .name(s.getName())
                                .tleDate(null)
                                .type(celestrakGroup)
                                .line1(s.getLine1())
                                .line2(s.getLine2())
                                .build())
                        .toList();
                return SatelliteListResponseDto.builder()
                        .satellites(items)
                        .totalItems(total)
                        .page(page)
                        .pageSize(pageSize)
                        .dataSource("celestrak")
                        .build();
            }
            // CelesTrak unreachable/empty — fall through to TLE API search
            log.warn("CelesTrak group '{}' returned empty, falling back to TLE API search", celestrakGroup);
            String searchTerm = GROUP_SEARCH_TERMS.getOrDefault(celestrakGroup, celestrakGroup);
            TleListResponseDto fallback = tleApiClient.getTleList(page, pageSize, searchTerm, sort);
            if (fallback != null && fallback.getMember() != null) {
                // Pre-populate TLE cache from fallback results too
                long now = System.currentTimeMillis();
                for (TleDto tle : fallback.getMember()) {
                    if (tle.getSatelliteId() != null && tle.getLine1() != null && tle.getLine2() != null) {
                        CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
                        dto.setNoradCatId(tle.getSatelliteId());
                        dto.setName(tle.getName());
                        dto.setLine1(tle.getLine1());
                        dto.setLine2(tle.getLine2());
                        tleCache.putIfAbsent(tle.getSatelliteId(), new CachedTle(dto, now));
                    }
                }
                List<SatelliteListItemDto> items = fallback.getMember().stream()
                        .map(tle -> SatelliteListItemDto.builder()
                                .satelliteId(tle.getSatelliteId())
                                .name(tle.getName())
                                .tleDate(tle.getDate())
                                .type(celestrakGroup)
                                .line1(tle.getLine1())
                                .line2(tle.getLine2())
                                .build())
                        .toList();
                return SatelliteListResponseDto.builder()
                        .satellites(items)
                        .totalItems(fallback.getTotalItems() != null ? fallback.getTotalItems() : items.size())
                        .page(page)
                        .pageSize(pageSize)
                        .dataSource("tle-api")
                        .build();
            }
        }

        // Fallback: tle.ivanstanojevic.me name search
        TleListResponseDto raw = tleApiClient.getTleList(page, pageSize, search, sort);
        if (raw == null || raw.getMember() == null) {
            return SatelliteListResponseDto.builder()
                    .satellites(Collections.emptyList())
                    .totalItems(0)
                    .page(page)
                    .pageSize(pageSize)
                    .dataSource("tle-api")
                    .build();
        }
        List<SatelliteListItemDto> items = raw.getMember().stream()
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
                .page(raw.getParameters() != null && raw.getParameters().getPage() != null ? raw.getParameters().getPage() : page)
                .pageSize(raw.getParameters() != null && raw.getParameters().getPageSize() != null ? raw.getParameters().getPageSize() : pageSize)
                .dataSource("tle-api")
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
