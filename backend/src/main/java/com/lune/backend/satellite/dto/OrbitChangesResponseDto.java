package com.lune.backend.satellite.dto;

import java.util.List;

/**
 * @param requested     satellites asked about
 * @param withHistory   of those, how many have at least two stored TLEs (the rest can't be compared yet)
 * @param historySince  when the backend started recording TLE history (ISO-8601), or null if it hasn't yet
 * @param satellites    only satellites with a detected change or decay
 */
public record OrbitChangesResponseDto(int requested, int withHistory, String historySince, List<OrbitChangeDto> satellites) {
}
