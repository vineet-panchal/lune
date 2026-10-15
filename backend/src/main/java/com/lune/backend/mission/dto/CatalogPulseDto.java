package com.lune.backend.mission.dto;

import com.lune.backend.satellite.dto.OrbitChangeDto;

import java.util.List;
import java.util.Map;

/**
 * What Lune itself sees in the active-satellite catalog: re-entries coming up, recent manoeuvres and the newest
 * launches' satellites.
 *
 * @param tracked           active satellites in the catalog
 * @param catalogUpdatedAt  when the catalog was downloaded (ISO-8601), or null while it's first loading
 * @param historySince      when TLE history recording started (ISO-8601), or null; changes can only be seen since then
 * @param withHistory       satellites with at least two stored TLEs (the rest can't be compared yet)
 * @param reentries         decaying satellites, soonest re-entry first
 * @param manoeuvreCounts   manoeuvres in the last week by type ("raise", "lower", "plane_change")
 * @param manoeuvres        the most recent manoeuvres, newest first
 * @param launches          satellites per launch, newest launches first ("2026-234" → its satellites)
 */
public record CatalogPulseDto(
        int tracked,
        String catalogUpdatedAt,
        boolean loading,
        String historySince,
        int withHistory,
        List<OrbitChangeDto> reentries,
        Map<String, Integer> manoeuvreCounts,
        List<Manoeuvre> manoeuvres,
        List<LaunchObjects> launches
) {

    /** One manoeuvre: the satellite and the change between two of its TLEs. */
    public record Manoeuvre(int satelliteId, String name, String type, String at, double deltaAltitudeKm,
                            double deltaInclinationDeg, double altitudeKm) {}

    /** The satellites from one launch that are in the catalog (names: a few examples; ids: all of them). */
    public record LaunchObjects(String designator, int count, List<String> names, List<Integer> ids) {}
}
