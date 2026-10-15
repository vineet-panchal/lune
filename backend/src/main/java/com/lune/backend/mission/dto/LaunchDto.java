package com.lune.backend.mission.dto;

/**
 * One launch from Launch Library 2, trimmed to what Mission Control shows.
 *
 * @param status        short status: "Go", "TBD", "TBC", "Hold", "In Flight", "Success", "Failure", "Partial Failure"
 * @param net           planned (or actual) lift-off time, ISO-8601 ("no earlier than")
 * @param netPrecision  how exact net is: "MIN", "HR", "DAY", "MONTH", ...
 * @param designator    international designator of the launch ("2026-234") once it has flown, else null; the
 *                      satellites it carried have TLEs whose designators start with it
 * @param probability   weather go probability in percent, if forecast
 */
public record LaunchDto(
        String id,
        String name,
        String missionName,
        String status,
        String statusName,
        String net,
        String netPrecision,
        String windowStart,
        String windowEnd,
        String provider,
        String rocket,
        String missionType,
        String missionDescription,
        String orbit,
        String padName,
        String location,
        String countryCode,
        Double padLatitude,
        Double padLongitude,
        String imageUrl,
        String thumbnailUrl,
        String designator,
        boolean webcastLive,
        String videoUrl,
        String failReason,
        Integer probability
) {
}
