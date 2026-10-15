package com.lune.backend.trips.dto;

import com.lune.backend.mission.dto.LaunchDto;

/**
 * An upcoming launch from Launch Library 2 whose mission heads for a planet or a moon, so Trips can plan it.
 *
 * @param destination  the planet or moon it's going to, as Trips names it ("Mars", "Phobos", "Moon")
 * @param planet       the planet that is, or that the moon goes round ("Earth" for our Moon)
 * @param reason       how the destination was read from Launch Library ("orbit: Mars Orbit; mentions Phobos")
 */
public record TripLaunchDto(LaunchDto launch, String destination, String planet, String reason) {
}
