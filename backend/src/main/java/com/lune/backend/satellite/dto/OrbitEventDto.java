package com.lune.backend.satellite.dto;

/**
 * One change between two consecutive TLEs of a satellite.
 *
 * @param type                "raise", "lower" or "plane_change"
 * @param from                epoch of the earlier TLE (ISO-8601)
 * @param to                  epoch of the later TLE (ISO-8601)
 * @param deltaAltitudeKm     change in mean altitude
 * @param deltaInclinationDeg change in inclination
 */
public record OrbitEventDto(String type, String from, String to, double deltaAltitudeKm, double deltaInclinationDeg) {
}
