package com.lune.backend.satellite.dto;

import java.util.List;

/**
 * One satellite's stored TLEs as orbit samples, oldest first.
 *
 * @param samples epoch (ISO-8601), mean altitude (km) and inclination (°) of each TLE
 */
public record OrbitHistoryDto(int satelliteId, String name, List<Sample> samples) {

    public record Sample(String epoch, double altitudeKm, double inclinationDeg) {}
}
