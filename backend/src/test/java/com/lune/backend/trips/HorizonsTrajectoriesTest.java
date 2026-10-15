package com.lune.backend.trips;

import com.lune.backend.trips.dto.TrajectoryDto;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HorizonsTrajectoriesTest {

    @Test
    void parseReadsTheVectorTableAsUtc() {
        String json = """
                {"result":"header\\n$$SOE\\n2443392.083333333, A.D. 1977-Sep-05 14:00:00.0000,  9.650848449458849E-01, -2.913275919757713E-01, -9.160796836034551E-06,  9.214730402774093E-03,  2.340464324875951E-02,  4.718075928999911E-04,\\n2447214.166666667, A.D. 1988-Feb-22 16:00:00.0000, -1.473659201304418E+01, -2.402386279903135E+01,  1.749640200077208E+01, -1.425219367994384E-03, -8.410032984642983E-03,  6.080717004747119E-03,\\n$$EOE\\nfooter"}
                """;
        HorizonsTrajectories.Samples s = HorizonsTrajectories.parse(JsonMapper.shared().readTree(json));
        assertEquals(2, s.size());
        // 1977-09-05 14:00 TDB is about 69 s earlier in UTC
        assertEquals(242_316_000_000L - 69_184, (long) s.t()[0], 1);
        assertEquals(0.9650848449458849, s.p()[0], 1e-15);
        assertEquals(6.080717004747119e-3, s.v()[5], 1e-18);
    }

    @Test
    void parseRejectsHorizonsErrors() {
        String json = """
                {"result":"No ephemeris","error":"No ephemeris for target prior to A.D. 1977-SEP-05"}
                """;
        assertThrows(IllegalStateException.class, () -> HorizonsTrajectories.parse(JsonMapper.shared().readTree(json)));
    }

    @Test
    void thinDropsPointsOnASmoothPathButKeepsTheEnds() {
        // A circular orbit of 1 AU sampled every day for a year: Hermite segments of many days fit it closely.
        int n = 366;
        double w = 2 * Math.PI / 365.25;
        double[] t = new double[n];
        double[] p = new double[n * 3];
        double[] v = new double[n * 3];
        for (int i = 0; i < n; i++) {
            t[i] = i * 86_400_000.0;
            p[i * 3] = Math.cos(w * i);
            p[i * 3 + 1] = Math.sin(w * i);
            v[i * 3] = -w * Math.sin(w * i);
            v[i * 3 + 1] = w * Math.cos(w * i);
        }
        TrajectoryDto thinned = HorizonsTrajectories.thin(new HorizonsTrajectories.Samples(t, p, v));
        int m = thinned.t().length;
        assertTrue(m < 40, "kept " + m);
        assertEquals(0, thinned.t()[0]);
        assertEquals(t[n - 1], thinned.t()[m - 1]);
    }

    @Test
    void fineWindowsCoverEncountersInsideTheDataRange() {
        TripMissions.Mission voyager2 = TripMissions.byId("voyager-2");
        long start = java.time.Instant.parse(voyager2.info().dataStart()).toEpochMilli();
        long stop = java.time.Instant.parse(voyager2.info().dataStop()).toEpochMilli();
        // Jupiter, Saturn, Uranus and Neptune; the launch and the heliopause milestone don't need detail.
        assertEquals(4, HorizonsTrajectories.fineWindows(voyager2.info(), start, stop).size());
    }

    @Test
    void everyMissionHasAUniqueIdAndAnOrderedDataRange() {
        List<String> ids = TripMissions.ALL.stream().map(m -> m.info().id()).toList();
        assertEquals(ids.size(), ids.stream().distinct().count());
        for (TripMissions.Mission m : TripMissions.ALL) {
            assertTrue(java.time.Instant.parse(m.info().dataStart()).isBefore(java.time.Instant.parse(m.info().dataStop())), m.info().id());
        }
    }
}
