package com.lune.backend.analytics.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ClusterRequestDto(
        String algorithm,
        Integer k,
        Double dbscanEps,
        Integer dbscanMinSamples,
        Double isolationContamination,
        List<ClusterPointDto> points
) {
}
