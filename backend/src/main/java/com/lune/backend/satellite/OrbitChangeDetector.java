package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.OrbitChangeDto;
import com.lune.backend.satellite.dto.OrbitEventDto;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Finds orbit changes in a satellite's TLE history by comparing consecutive TLEs.
 *
 * Mean altitude from a TLE is fitted to tracking data and wobbles by a few hundred metres between updates;
 * natural drag only ever lowers an orbit, and above ~350 km by well under a kilometre a day. So:
 *  - raise:        mean altitude went up by more than RAISE_MIN_KM (drag can't do that; an engine did)
 *  - lower:        it dropped faster than LOWER_MIN_RATE_KM_PER_DAY while above NATURAL_DECAY_FLOOR_KM
 *  - plane change: inclination moved more than PLANE_CHANGE_MIN_DEG (fit noise is ~0.01°)
 *  - decaying:     below NATURAL_DECAY_FLOOR_KM and losing altitude overall; re-entry time is a straight-line
 *                  estimate to REENTRY_ALTITUDE_KM (decay speeds up as it drops, so it's an upper bound)
 */
public final class OrbitChangeDetector {

    static final double RAISE_MIN_KM = 1.0;
    static final double LOWER_MIN_RATE_KM_PER_DAY = 2.0;
    static final double PLANE_CHANGE_MIN_DEG = 0.05;
    static final double NATURAL_DECAY_FLOOR_KM = 350.0;
    static final double REENTRY_ALTITUDE_KM = 200.0;
    /** A downward trend has to be at least this steep to call it decay rather than fit noise. */
    static final double DECAY_MIN_RATE_KM_PER_DAY = 0.05;
    /** Rates over very short gaps are mostly noise. */
    static final double MIN_GAP_DAYS = 0.25;
    private static final int MAX_EVENTS = 10;
    private static final double MS_PER_DAY = 86_400_000.0;

    private OrbitChangeDetector() {}

    /** Changes for one satellite, or empty if it has fewer than two samples or nothing stands out. */
    public static Optional<OrbitChangeDto> detect(int noradId, List<TleHistory.Sample> samples) {
        if (samples.size() < 2) {
            return Optional.empty();
        }
        List<OrbitEventDto> events = new ArrayList<>();
        for (int i = 1; i < samples.size(); i++) {
            TleElements a = samples.get(i - 1).elements();
            TleElements b = samples.get(i).elements();
            double days = (b.epochMs() - a.epochMs()) / MS_PER_DAY;
            double dAlt = b.meanAltitudeKm() - a.meanAltitudeKm();
            double dInc = b.inclinationDeg() - a.inclinationDeg();
            String type = null;
            if (Math.abs(dInc) > PLANE_CHANGE_MIN_DEG) {
                type = "plane_change";
            } else if (dAlt > RAISE_MIN_KM) {
                type = "raise";
            } else if (days >= MIN_GAP_DAYS && dAlt / days < -LOWER_MIN_RATE_KM_PER_DAY
                    && a.meanAltitudeKm() > NATURAL_DECAY_FLOOR_KM) {
                type = "lower";
            }
            if (type != null) {
                events.add(new OrbitEventDto(type, Instant.ofEpochMilli(a.epochMs()).toString(),
                        Instant.ofEpochMilli(b.epochMs()).toString(), round(dAlt, 2), round(dInc, 3)));
            }
        }

        TleElements first = samples.get(0).elements();
        TleElements last = samples.get(samples.size() - 1).elements();
        double spanDays = (last.epochMs() - first.epochMs()) / MS_PER_DAY;
        Double rate = spanDays >= MIN_GAP_DAYS ? (last.meanAltitudeKm() - first.meanAltitudeKm()) / spanDays : null;
        boolean decaying = rate != null && rate < -DECAY_MIN_RATE_KM_PER_DAY && last.meanAltitudeKm() < NATURAL_DECAY_FLOOR_KM;
        Double daysToReentry = decaying ? round(Math.max(0, last.meanAltitudeKm() - REENTRY_ALTITUDE_KM) / -rate, 1) : null;

        if (events.isEmpty() && !decaying) {
            return Optional.empty();
        }
        List<OrbitEventDto> recent = events.subList(Math.max(0, events.size() - MAX_EVENTS), events.size());
        return Optional.of(new OrbitChangeDto(noradId, samples.get(samples.size() - 1).name(), samples.size(),
                round(last.meanAltitudeKm(), 1), rate == null ? null : round(rate, 3), decaying, daysToReentry,
                List.copyOf(recent)));
    }

    private static double round(double value, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }
}
