package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class SatelliteService {

    private static final DateTimeFormatter ISO_FORMAT = DateTimeFormatter.ISO_INSTANT;
    private static final int DEFAULT_TRAIL_POINTS_EACH_SIDE = 5;
    private static final double MIN_SPEED_KM_S = 2.0; // avoid div by zero for very slow objects

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

    private static SatelliteListItemDto item(int id, String name) {
        return SatelliteListItemDto.builder().satelliteId(id).name(name).tleDate(null).build();
    }

    private final TleApiClient tleApiClient;

    public SatelliteListResponseDto getSatellites(int page, int pageSize, String search, String sort, String group) {
        if ("popular".equalsIgnoreCase(group != null ? group.strip() : null)) {
            int total = POPULAR_SATELLITES.size();
            int from = Math.min((page - 1) * pageSize, total);
            int to = Math.min(from + pageSize, total);
            List<SatelliteListItemDto> pageItems = from < to ? POPULAR_SATELLITES.subList(from, to) : List.of();
            return SatelliteListResponseDto.builder()
                    .satellites(pageItems)
                    .totalItems(total)
                    .page(page)
                    .pageSize(pageSize)
                    .build();
        }
        TleListResponseDto raw = tleApiClient.getTleList(page, pageSize, search, sort);
        if (raw == null || raw.getMember() == null) {
            return SatelliteListResponseDto.builder()
                    .satellites(Collections.emptyList())
                    .totalItems(0)
                    .page(page)
                    .pageSize(pageSize)
                    .build();
        }
        List<SatelliteListItemDto> items = raw.getMember().stream()
                .map(tle -> SatelliteListItemDto.builder()
                        .satelliteId(tle.getSatelliteId())
                        .name(tle.getName())
                        .tleDate(tle.getDate())
                        .build())
                .toList();
        return SatelliteListResponseDto.builder()
                .satellites(items)
                .totalItems(raw.getTotalItems() != null ? raw.getTotalItems() : items.size())
                .page(raw.getParameters() != null && raw.getParameters().getPage() != null ? raw.getParameters().getPage() : page)
                .pageSize(raw.getParameters() != null && raw.getParameters().getPageSize() != null ? raw.getParameters().getPageSize() : pageSize)
                .build();
    }

    public Optional<TleDto> getSatellite(int satelliteId) {
        return tleApiClient.getTle(satelliteId);
    }

    public Optional<SatellitePositionDto> getPosition(int satelliteId, Instant instant) {
        return tleApiClient.propagate(satelliteId, instant)
                .map(r -> toPositionDto(r, instant));
    }

    /**
     * Get current position plus trail points (past and future) for orbit trail visualization.
     * trailKm: approximate distance in km each direction (default 30).
     * Uses the external TLE propagate API for each point; for high traffic consider adding local SGP4.
     */
    public Optional<SatelliteTrailDto> getTrail(int satelliteId, Instant instant, double trailKm) {
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
