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

    private static final double DEFAULT_TRAIL_KM = 30.0;

    private final SatelliteService satelliteService;

    /**
     * List satellites (paginated). Data from TLE catalog.
     * Optional: search (filter by name, e.g. ISS, NOAA, Starlink), sort (e.g. popularity, name),
     * group=popular (curated list only, no external catalog call).
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
        public ResponseEntity<SatelliteListResponseDto> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String group,
            @RequestParam(required = false) String type) {
        SatelliteListResponseDto body = satelliteService.getSatellites(
            page, Math.min(pageSize, 500), search, sort, group, type);
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
        List<Integer> parsedIds = java.util.Arrays.stream(ids.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .limit(500)
                .map(s -> {
                    try { return Integer.parseInt(s); } catch (NumberFormatException e) { return null; }
                })
                .filter(java.util.Objects::nonNull)
                .toList();
        List<SatellitePositionDto> results = parsedIds.parallelStream()
                .map(id -> satelliteService.getPosition(id, instant))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .toList();
        return ResponseEntity.ok(results);
    }
}
