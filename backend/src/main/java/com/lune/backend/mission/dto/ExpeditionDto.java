package com.lune.backend.mission.dto;

import java.util.List;

/**
 * A crew living on a space station now.
 *
 * @param stationNoradId the station's NORAD id when Lune knows it (for "track it" links), else null
 */
public record ExpeditionDto(String name, String station, Integer stationNoradId, String start, List<CrewMember> crew) {

    /**
     * @param timeInSpace total time in space as an ISO-8601 duration ("P182DT23H17M53S"), if known
     */
    public record CrewMember(
            String name,
            String role,
            String agency,
            String countryCode,
            String imageUrl,
            String wikiUrl,
            Integer flights,
            String timeInSpace
    ) {
    }
}
