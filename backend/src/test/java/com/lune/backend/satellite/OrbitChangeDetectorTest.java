package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.OrbitChangeDto;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OrbitChangeDetectorTest {

    private static final long DAY_MS = 86_400_000L;
    private static final long T0 = Instant.parse("2026-10-01T00:00:00Z").toEpochMilli();

    private static TleHistory.Sample sample(double days, double altitudeKm, double inclinationDeg) {
        return new TleHistory.Sample("TEST", "", "", new TleElements(T0 + Math.round(days * DAY_MS), altitudeKm, inclinationDeg));
    }

    @Test
    void parsesIssTle() {
        TleElements e = TleElements.parse(
                "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005",
                "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 22222").orElseThrow();
        assertEquals(Instant.parse("2024-01-01T12:00:00Z").toEpochMilli(), e.epochMs());
        assertEquals(51.6416, e.inclinationDeg(), 1e-9);
        assertEquals(420, e.meanAltitudeKm(), 10); // ISS mean altitude ~420 km
    }

    @Test
    void steadyOrbitHasNoChanges() {
        assertTrue(OrbitChangeDetector.detect(1, List.of(
                sample(0, 550.0, 53.05), sample(0.5, 549.9, 53.05), sample(1, 550.1, 53.051))).isEmpty());
    }

    @Test
    void oneSampleCannotBeCompared() {
        assertTrue(OrbitChangeDetector.detect(1, List.of(sample(0, 550, 53))).isEmpty());
    }

    @Test
    void detectsRaise() {
        OrbitChangeDto change = OrbitChangeDetector.detect(1, List.of(sample(0, 300, 53), sample(1, 305, 53))).orElseThrow();
        assertEquals(1, change.events().size());
        assertEquals("raise", change.events().get(0).type());
        assertEquals(5.0, change.events().get(0).deltaAltitudeKm(), 1e-9);
        assertFalse(change.decaying());
    }

    @Test
    void fastDropHighUpIsALoweringManoeuvre() {
        OrbitChangeDto change = OrbitChangeDetector.detect(1, List.of(sample(0, 540, 53), sample(1, 530, 53))).orElseThrow();
        assertEquals("lower", change.events().get(0).type());
    }

    @Test
    void slowNaturalDecayHighUpIsNotAnEvent() {
        assertTrue(OrbitChangeDetector.detect(1, List.of(sample(0, 540, 53), sample(1, 539.5, 53))).isEmpty());
    }

    @Test
    void detectsPlaneChange() {
        OrbitChangeDto change = OrbitChangeDetector.detect(1, List.of(sample(0, 550, 53.0), sample(1, 550, 53.2))).orElseThrow();
        assertEquals("plane_change", change.events().get(0).type());
    }

    @Test
    void lowAndFallingIsDecayingWithReentryEstimate() {
        Optional<OrbitChangeDto> change = OrbitChangeDetector.detect(1, List.of(
                sample(0, 300, 53), sample(2, 296, 53), sample(4, 292, 53)));
        assertTrue(change.isPresent());
        assertTrue(change.get().decaying());
        assertEquals(-2.0, change.get().altitudeRateKmPerDay(), 1e-9);
        assertEquals(46.0, change.get().daysToReentry(), 1e-9); // (292 - 200) km at 2 km/day
    }
}
