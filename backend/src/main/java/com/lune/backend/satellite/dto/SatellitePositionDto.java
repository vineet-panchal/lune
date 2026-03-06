package com.lune.backend.satellite.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Position of a satellite at a given time.
 * ECI (Earth-Centered Inertial) coordinates in km for 3D globe rendering.
 * Geodetic (lat/lon/alt) for map overlay. Velocity in km/s.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SatellitePositionDto {

    private Integer satelliteId;
    private String name;
    private String datetime;

    /** ECI position in km (x, y, z) - use for 3D globe */
    private double positionX;
    private double positionY;
    private double positionZ;

    /** Geodetic: degrees and km */
    private double latitude;
    private double longitude;
    private double altitudeKm;

    /** Velocity in km/s (ECI) */
    private double velocityX;
    private double velocityY;
    private double velocityZ;
    private double speedKmPerSec;
}
