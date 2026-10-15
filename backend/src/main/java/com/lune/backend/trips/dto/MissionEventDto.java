package com.lune.backend.trips.dto;

/**
 * A moment in a mission: launch, a flyby, arriving in orbit, a landing, the end.
 *
 * @param time  ISO-8601 (UTC); to the hour where the exact time isn't notable
 * @param kind  "launch", "flyby", "arrival", "landing", "milestone" or "end"
 * @param body  the planet or object involved ("Jupiter", "Arrokoth"), or null
 */
public record MissionEventDto(String time, String kind, String label, String body) {
}
