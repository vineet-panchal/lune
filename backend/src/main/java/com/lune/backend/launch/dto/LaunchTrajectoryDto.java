package com.lune.backend.launch.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Simplified trajectory for a future mission (e.g. launch site to Moon).
 * Frontend can draw a line from origin to destination; later can be refined with real ephemeris.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LaunchTrajectoryDto {

    private String launchId;
    private String missionName;
    private String originName;   // e.g. "Kennedy Space Center"
    private double originLat;
    private double originLon;
    private String destinationName; // e.g. "Moon"
    private double destinationLat;   // for Moon/Mars: simplified surface coords or N/A
    private double destinationLon;
    /** Optional: segment points for a curved path (e.g. [x,y,z] in km for 3D) */
    private List<double[]> pathSegments;
}
