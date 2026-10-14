package com.lune.backend.satellite.dto;

import java.util.List;

/**
 * What changed in one satellite's orbit over its stored TLE history.
 *
 * @param samples               how many distinct TLEs are stored for it
 * @param altitudeRateKmPerDay  mean-altitude trend from the oldest to the newest TLE (null if they're too close)
 * @param daysToReentry         decaying only: straight-line estimate of days until 200 km
 * @param events                most recent changes, oldest first
 */
public record OrbitChangeDto(
        int satelliteId,
        String name,
        int samples,
        double latestAltitudeKm,
        Double altitudeRateKmPerDay,
        boolean decaying,
        Double daysToReentry,
        List<OrbitEventDto> events
) {
}
