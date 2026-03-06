package com.lune.backend.trajectory.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Simplified trajectory from Earth coordinates to Mars (or other destination).
 * Path is a list of points for the frontend to draw; later can use proper ephemeris.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TrajectoryResponseDto {

    private String destination;
    private double originLat;
    private double originLon;
    private String launchDate;
    /** Approx transfer duration in days (e.g. Hohmann-style) */
    private double transferDays;
    /** Path segments: list of [x, y, z] in km (e.g. Earth-centered) or lat/lon/alt for display */
    private List<double[]> pathPoints;
}
