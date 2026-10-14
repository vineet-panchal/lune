package com.lune.backend.satellite;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;

/**
 * The orbit facts orbit-change detection compares, read straight from a TLE's fixed columns.
 *
 * @param epochMs           when the TLE describes the orbit (UTC millis)
 * @param meanAltitudeKm    semi-major axis from the mean motion, minus Earth's radius
 * @param inclinationDeg    tilt of the orbit from the equator
 */
public record TleElements(long epochMs, double meanAltitudeKm, double inclinationDeg) {

    private static final double MU_KM3_S2 = 398600.4418;
    private static final double EARTH_RADIUS_KM = 6378.137;
    private static final double SECONDS_PER_DAY = 86_400.0;

    public static Optional<TleElements> parse(String line1, String line2) {
        if (line1 == null || line2 == null || line1.length() < 32 || line2.length() < 63) {
            return Optional.empty();
        }
        try {
            long epochMs = epochMs(line1.substring(18, 20), line1.substring(20, 32));
            double inclination = Double.parseDouble(line2.substring(8, 16).trim());
            double revsPerDay = Double.parseDouble(line2.substring(52, 63).trim());
            if (revsPerDay <= 0) {
                return Optional.empty();
            }
            double meanMotionRadS = revsPerDay * 2 * Math.PI / SECONDS_PER_DAY;
            double semiMajorKm = Math.cbrt(MU_KM3_S2 / (meanMotionRadS * meanMotionRadS));
            return Optional.of(new TleElements(epochMs, semiMajorKm - EARTH_RADIUS_KM, inclination));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    /** TLE epoch: 2-digit year (57–99 → 19xx) and fractional day of the year, 1 = 1 January 00:00 UTC. */
    static long epochMs(String yy, String dayOfYear) {
        int twoDigit = Integer.parseInt(yy.trim());
        int year = twoDigit < 57 ? 2000 + twoDigit : 1900 + twoDigit;
        double day = Double.parseDouble(dayOfYear.trim());
        long startOfYear = LocalDate.of(year, 1, 1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        return startOfYear + Math.round((day - 1) * SECONDS_PER_DAY * 1000);
    }
}
