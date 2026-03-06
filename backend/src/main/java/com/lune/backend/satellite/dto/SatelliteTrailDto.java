package com.lune.backend.satellite.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Current position plus trail points (past and future) for orbit trail visualization.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SatelliteTrailDto {

    private Integer satelliteId;
    private String name;

    /** Current position */
    private SatellitePositionDto current;

    /**
     * Trail points: [ ..., past2, past1, current, future1, future2, ... ]
     * Each point has ECI (x,y,z) in km for drawing the line on the globe.
     */
    private List<TrailPointDto> trail;
}
