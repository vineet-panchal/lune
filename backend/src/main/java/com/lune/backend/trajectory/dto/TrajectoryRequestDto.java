package com.lune.backend.trajectory.dto;

import lombok.Data;

@Data
public class TrajectoryRequestDto {

    /** Origin latitude (degrees) */
    private double originLat;
    /** Origin longitude (degrees) */
    private double originLon;
    /** Destination: "mars" supported */
    private String destination;
    /** Optional: launch date (ISO-8601) for transfer window */
    private String launchDate;
}
