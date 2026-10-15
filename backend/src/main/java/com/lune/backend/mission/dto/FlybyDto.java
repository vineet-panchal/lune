package com.lune.backend.mission.dto;

/**
 * An asteroid passing close to Earth, from JPL's close-approach data.
 *
 * @param time            time of closest approach (ISO-8601, UTC)
 * @param distanceKm      nominal miss distance from Earth's centre
 * @param lunarDistances  the same in Earth–Moon distances (384,400 km)
 * @param speedKmS        speed relative to Earth
 * @param magnitude       absolute magnitude H: smaller is bigger
 * @param diameterMinM    smallest likely size from H (a bright, 25 % albedo surface); diameterMaxM: a dark, 5 % one
 */
public record FlybyDto(
        String designation,
        String time,
        double distanceKm,
        double lunarDistances,
        double speedKmS,
        double magnitude,
        double diameterMinM,
        double diameterMaxM
) {
}
