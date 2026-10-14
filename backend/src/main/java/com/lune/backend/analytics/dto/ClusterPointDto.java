package com.lune.backend.analytics.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * One satellite to cluster. features is whatever the client chose to compare satellites by (e.g. position
 * x/y/z, or orbital elements); every point in a request has the same features in the same order.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ClusterPointDto(
        long satelliteId,
        String name,
        List<Double> features
) {
}
