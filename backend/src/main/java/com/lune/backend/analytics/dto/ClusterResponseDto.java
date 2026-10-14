package com.lune.backend.analytics.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ClusterResponseDto(
        List<Integer> labels,
        int nClusters,
        Double inertia,
        String algorithm,
        Integer noiseCount,
        /** Gaussian mixture only: each point's highest membership probability (0..1); null otherwise. */
        List<Double> confidence
) {
}
