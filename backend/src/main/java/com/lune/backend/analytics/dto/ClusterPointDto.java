package com.lune.backend.analytics.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ClusterPointDto(
        long satelliteId,
        String name,
        double altitudeKm,
        double inclinationDeg,
        double meanMotionRpd
) {
}
