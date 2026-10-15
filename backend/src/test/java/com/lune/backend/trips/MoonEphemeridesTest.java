package com.lune.backend.trips;

import com.lune.backend.trips.dto.MoonElementsDto;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MoonEphemeridesTest {

    @Test
    void parseReadsTheElementsTable() {
        // Phobos, as Horizons answered for 2026-01-01 (two rows).
        String json = """
                {"result":"header\\n$$SOE\\n2461041.500000000, A.D. 2026-Jan-01 00:00:00.0000,  1.548776609879642E-02,  9.233110848156768E+03,  3.818340357087061E+01,  4.738186679172486E+01,  1.993037344674576E+02,  2.461041490067914E+06,  1.305563605968393E-02,  1.120346253517750E+01,  1.155495627982169E+01,  9.378360705148247E+03,  9.523610562139726E+03,  2.757429805443853E+04,\\n2461051.500000000, A.D. 2026-Jan-11 00:00:00.0000,  1.490496164890757E-02,  9.238000534694289E+03,  3.816760996833190E+01,  4.725063303476863E+01,  2.042591119613210E+02,  2.461051380509772E+06,  1.305685726497420E-02,  1.347984155832886E+02,  1.359945844002613E+02,  9.377775925211618E+03,  9.517551315728946E+03,  2.757171903576839E+04,\\n$$EOE\\nfooter"}
                """;
        MoonElementsDto el = MoonEphemerides.parse(JsonMapper.shared().readTree(json));
        assertEquals(2, el.t().length);
        assertEquals(Instant.parse("2026-01-01T00:00:00Z").toEpochMilli() - 69_184, (long) el.t()[0], 1);
        assertEquals(9378.360705148247, el.a()[0], 1e-9);
        assertEquals(0.01548776609879642, el.e()[0], 1e-15);
        assertEquals(38.18340357087061, el.i()[0], 1e-12);
        assertEquals(47.38186679172486, el.node()[0], 1e-12);
        assertEquals(199.3037344674576, el.peri()[0], 1e-12);
        assertEquals(11.2034625351775, el.ma()[0], 1e-12);
        assertEquals(0.01305563605968393, el.n()[0], 1e-15);
    }

    @Test
    void parseRejectsHorizonsErrors() {
        assertThrows(IllegalStateException.class, () -> MoonEphemerides.parse(JsonMapper.shared().readTree("{\"error\":\"bad\"}")));
        assertThrows(IllegalStateException.class, () -> MoonEphemerides.parse(JsonMapper.shared().readTree("{\"result\":\"nothing\"}")));
    }

    @Test
    void sliceKeepsTheYearPlusOneSampleEitherSide() {
        // A sample every 2 days from 2015 to the end of 2064.
        long start = Instant.parse("2015-01-01T00:00:00Z").toEpochMilli();
        int n = 9132;
        double[] t = new double[n];
        double[] z = new double[n];
        for (int i = 0; i < n; i++) t[i] = start + i * 2 * 86_400_000.0;
        MoonElementsDto all = new MoonElementsDto(t, z, z, z, z, z, z, z);

        MoonElementsDto y2030 = MoonEphemerides.slice(all, 2030);
        long from = Instant.parse("2030-01-01T00:00:00Z").toEpochMilli();
        long to = Instant.parse("2031-01-01T00:00:00Z").toEpochMilli();
        int m = y2030.t().length;
        assertTrue(y2030.t()[0] < from && y2030.t()[1] >= from);
        assertTrue(y2030.t()[m - 1] >= to && y2030.t()[m - 2] < to);
        assertEquals(185, m, 2);

        // Outside the span: the nearest two samples.
        assertEquals(t[0], MoonEphemerides.slice(all, 1990).t()[0]);
        assertEquals(2, MoonEphemerides.slice(all, 1990).t().length);
        assertEquals(t[n - 1], MoonEphemerides.slice(all, 2090).t()[1]);
    }
}
