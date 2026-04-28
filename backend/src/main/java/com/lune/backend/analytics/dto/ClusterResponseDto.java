package com.lune.backend.analytics.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ClusterResponseDto(List<Integer> labels, int nClusters, Double inertia) {
}
