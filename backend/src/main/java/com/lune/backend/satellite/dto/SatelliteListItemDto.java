package com.lune.backend.satellite.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SatelliteListItemDto {

    private Integer satelliteId;
    private String name;
    private String tleDate; // last TLE update
    private String type; // e.g. Internet, Communications, etc.
    private String line1; // TLE line 1 (for client-side SGP4 propagation)
    private String line2; // TLE line 2 (for client-side SGP4 propagation)
}
