package com.lune.backend.trips.dto;

import java.util.List;

/**
 * A real interplanetary mission whose path JPL Horizons has.
 *
 * @param status     "operating" (working, at its target or beyond), "en-route" (still travelling to its target)
 *                   or "complete" (the mission is over)
 * @param dataStart  first moment of the trajectory Lune shows (ISO-8601, UTC)
 * @param dataStop   last moment; for missions still flying this runs into the future (JPL's planned path)
 */
public record TripMissionDto(
        String id,
        String name,
        String agency,
        String launchVehicle,
        String launchSite,
        String status,
        List<String> targets,
        String summary,
        String dataStart,
        String dataStop,
        List<MissionEventDto> events
) {
}
