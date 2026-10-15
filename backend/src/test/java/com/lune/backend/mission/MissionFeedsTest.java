package com.lune.backend.mission;

import com.lune.backend.mission.dto.FlybyDto;
import com.lune.backend.mission.dto.SpaceWeatherDto;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MissionFeedsTest {

    @Test
    void flybysReadJplColumnsByName() {
        String json = """
                {"fields":["des","orbit_id","jd","cd","dist","dist_min","dist_max","v_rel","v_inf","t_sigma_f","h"],
                 "data":[["2026 TP6","6","2461328.5","2026-Oct-15 00:01","0.00146363563551003","0","0","10.2861339365415","0","<","27.259"]]}
                """;
        List<FlybyDto> flybys = MissionFeeds.parseFlybys(JsonMapper.shared().readTree(json));
        FlybyDto f = flybys.get(0);
        assertEquals("2026 TP6", f.designation());
        assertEquals("2026-10-15T00:01:00Z", f.time());
        assertEquals(218_957, f.distanceKm(), 1);
        assertEquals(0.57, f.lunarDistances(), 0.001);
        assertEquals(10.29, f.speedKmS(), 0.001);
        // H 27.3: about 9 m if bright, 21 m if dark
        assertEquals(9, f.diameterMinM(), 1);
        assertEquals(21, f.diameterMaxM(), 1);
    }

    @Test
    void scalesReadNowLast24hAndForecast() {
        String json = """
                {"-1":{"R":{"Scale":"1"},"S":{"Scale":"0"},"G":{"Scale":"2"}},
                 "0":{"R":{"Scale":"0"},"S":{"Scale":"0"},"G":{"Scale":"1"}},
                 "1":{"DateStamp":"2026-10-15","R":{"Scale":null,"MinorProb":"20","MajorProb":"5"},"S":{"Prob":"5"},"G":{"Scale":"0"}}}
                """;
        SpaceWeatherDto.Scales scales = MissionFeeds.parseScales(JsonMapper.shared().readTree(json));
        assertEquals(new SpaceWeatherDto.Levels(0, 0, 1), scales.now());
        assertEquals(new SpaceWeatherDto.Levels(1, 0, 2), scales.last24h());
        assertEquals(new SpaceWeatherDto.Outlook("2026-10-15", 20, 5, 5, 0), scales.forecast().get(0));
    }

    @Test
    void unexpectedAnswersAreRejectedNotStored() {
        assertThrows(IllegalStateException.class, () -> MissionFeeds.parseNews(JsonMapper.shared().readTree("{\"detail\":\"throttled\"}")));
        assertThrows(IllegalStateException.class, () -> MissionFeeds.parseScales(JsonMapper.shared().readTree("[]")));
    }

    @Test
    void launchDesignatorMatchesLaunchLibrary() {
        assertEquals("1998-067", CatalogPulseService.launchDesignator("1 25544U 98067A   26287.50000000  .00010000  00000-0  18000-3 0  9990"));
        assertEquals("2026-234", CatalogPulseService.launchDesignator("1 70001U 26234C   26287.50000000  .00010000  00000-0  18000-3 0  9990"));
        assertNull(CatalogPulseService.launchDesignator("1 99999U          26287.50000000"));
    }
}
