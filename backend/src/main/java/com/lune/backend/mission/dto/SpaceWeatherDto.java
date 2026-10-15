package com.lune.backend.mission.dto;

import java.util.List;

/** Space weather from NOAA's Space Weather Prediction Center; each part is its own feed. */
public final class SpaceWeatherDto {

    private SpaceWeatherDto() {}

    /**
     * Planetary K-index over a 3-hour block: 0 (quiet) to 9 (extreme storm); 5+ is a geomagnetic storm.
     *
     * @param kind "observed", "estimated" or "predicted"
     * @param scale NOAA G-scale for that block ("G1".."G5"), or null below storm level
     */
    public record KpPoint(String time, double kp, String kind, String scale) {}

    /**
     * NOAA space weather scales: R (radio blackouts, from flares), S (solar radiation storms), G (geomagnetic storms),
     * each 0 (none) to 5 (extreme).
     *
     * @param last24h the strongest of each in the last 24 hours
     * @param forecast the next days' outlook
     */
    public record Scales(Levels now, Levels last24h, List<Outlook> forecast) {}

    public record Levels(int r, int s, int g) {}

    /** Chances (percent) of minor (R1–R2) and major (R3+) radio blackouts and of an S1+ storm, plus the expected G. */
    public record Outlook(String date, Integer rMinorPercent, Integer rMajorPercent, Integer sPercent, int g) {}

    /**
     * The latest solar flare seen by the GOES satellites, and the X-ray level now. Classes go A, B, C, M, X
     * (each ten times the last); M and X flares can black out radio on Earth's day side.
     */
    public record Flare(String peakClass, String peakTime, String beginTime, String endTime, String currentClass) {}
}
