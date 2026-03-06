package com.lune.backend.launch.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Represents a planned/future space launch (e.g. Artemis III, SpaceX mission).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FutureLaunchDto {

    private String id;
    private String name;
    private String description;
    private String agency;       // NASA, SpaceX, etc.
    private String rocket;
    private Instant windowStart; // NET (No Earlier Than)
    private Instant windowEnd;
    private String destination; // Moon, Mars, ISS, etc.
    private String missionType; // crewed, cargo, etc.
}
