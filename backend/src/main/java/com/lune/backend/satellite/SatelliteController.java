package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/satellites")
@RequiredArgsConstructor
@CrossOrigin(origins = {"http://localhost:3000", "http://127.0.0.1:3000"}, allowCredentials = "true")
public class SatelliteController {

    // Large enough to return a whole group (Starlink is ~10k) in one response; lists come from memory.
    private static final int MAX_PAGE_SIZE = 20_000;

    private static final double DEFAULT_TRAIL_KM = 30.0;

    /** Enough for a cluster's worth of altitude lines; each satellite can have up to 60 samples. */
    private static final int MAX_HISTORY_IDS = 500;

    /** A launch can carry a few hundred satellites; the ids list is in the query string. */
    private static final int MAX_ID_LIST = 1000;

    private final SatelliteService satelliteService;
    private final OrbitChangeService orbitChangeService;

    /**
     * List satellites (paginated). Data from TLE catalog.
     * Optional: search (filter by name, e.g. ISS, NOAA, Starlink), sort (e.g. popularity, name),
     * group=popular (curated list only, no external catalog call), ids=25544,48274 (exactly these satellites,
     * e.g. one launch's satellites from Mission Control).
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
        public ResponseEntity<SatelliteListResponseDto> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String group,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String ids) {
        SatelliteListResponseDto body = ids != null && !ids.isBlank()
            ? satelliteService.getSatellitesByIds(page, Math.min(pageSize, MAX_PAGE_SIZE), parseIds(ids, MAX_ID_LIST))
            : satelliteService.getSatellites(page, Math.min(pageSize, MAX_PAGE_SIZE), search, sort, group, type);
        return ResponseEntity.ok(body);
        }

    /**
     * Get one satellite's TLE by NORAD ID.
     */
    @GetMapping(value = "/{satelliteId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<TleDto> get(@PathVariable int satelliteId) {
        Optional<TleDto> opt = satelliteService.getSatellite(satelliteId);
        return opt.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get satellite position at a given time (UTC).
     * Use for single-position updates on the globe.
     */
    @GetMapping(value = "/{satelliteId}/position", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<SatellitePositionDto> getPosition(
            @PathVariable int satelliteId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) ZonedDateTime datetime) {
        Instant instant = datetime != null ? datetime.withZoneSameInstant(ZoneOffset.UTC).toInstant() : Instant.now();
        Optional<SatellitePositionDto> opt = satelliteService.getPosition(satelliteId, instant);
        return opt.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get satellite position plus trail (past and future) for orbit trail visualization.
     * trailKm: approximate distance in km each direction (default 30).
     */
    @GetMapping(value = "/{satelliteId}/trail", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<SatelliteTrailDto> getTrail(
            @PathVariable int satelliteId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) ZonedDateTime datetime,
            @RequestParam(defaultValue = "30") double trailKm) {
        Instant instant = datetime != null ? datetime.withZoneSameInstant(ZoneOffset.UTC).toInstant() : Instant.now();
        double km = Math.min(Math.max(trailKm, 5), 50);
        Optional<SatelliteTrailDto> opt = satelliteService.getTrail(satelliteId, instant, km);
        return opt.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Batch: get current positions for multiple satellites (e.g. for globe overlay).
     * ids: comma-separated NORAD IDs (e.g. ids=25544,49260,20580). datetime is optional (default now).
     */
    @GetMapping(value = "/positions", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<SatellitePositionDto>> getPositions(
            @RequestParam String ids,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) ZonedDateTime datetime) {
        Instant instant = datetime != null ? datetime.withZoneSameInstant(ZoneOffset.UTC).toInstant() : Instant.now();
        List<SatellitePositionDto> results = parseIds(ids, 500).parallelStream()
                .map(id -> satelliteService.getPosition(id, instant))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .toList();
        return ResponseEntity.ok(results);
    }

    /**
     * Orbit changes (manoeuvres, decay) for the given satellites, from the TLE history the backend has collected.
     * POST because the UI sends every loaded satellite (up to ~12k IDs).
     */
    @PostMapping(value = "/orbit-changes", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<OrbitChangesResponseDto> orbitChanges(@RequestBody OrbitChangesRequestDto request) {
        List<Integer> ids = request.ids() == null ? List.of() : request.ids();
        return ResponseEntity.ok(orbitChangeService.find(ids.stream().limit(MAX_PAGE_SIZE).toList()));
    }

    /** Orbit history (one sample per stored TLE) for up to MAX_HISTORY_IDS satellites. */
    @PostMapping(value = "/history", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<OrbitHistoryDto>> history(@RequestBody OrbitChangesRequestDto request) {
        List<Integer> ids = request.ids() == null ? List.of() : request.ids();
        return ResponseEntity.ok(orbitChangeService.history(ids.stream().limit(MAX_HISTORY_IDS).toList()));
    }

    /** Comma-separated NORAD IDs; anything that isn't a number is skipped. */
    private static List<Integer> parseIds(String ids, int limit) {
        return java.util.Arrays.stream(ids.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .limit(limit)
                .map(s -> {
                    try { return Integer.parseInt(s); } catch (NumberFormatException e) { return null; }
                })
                .filter(java.util.Objects::nonNull)
                .toList();
    }
}
