package com.lune.backend.satellite.dto;

import java.util.List;

/** NORAD IDs to check for orbit changes or fetch history for (satellites loaded in the UI). */
public record OrbitChangesRequestDto(List<Integer> ids) {
}
