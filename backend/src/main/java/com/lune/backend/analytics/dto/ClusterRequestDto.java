package com.lune.backend.analytics.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ClusterRequestDto(int k, List<ClusterPointDto> points) {
}
