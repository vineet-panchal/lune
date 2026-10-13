package com.lune.backend.satellite.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SatelliteListResponseDto {

    private List<SatelliteListItemDto> satellites;
    private int totalItems;
    private int page;
    private int pageSize;
    /** Where the data was fetched from: "celestrak", "tle-api", or both joined with "+" */
    private String dataSource;
    /** When the TLEs were downloaded (ISO-8601); clients propagate positions from these to the current time. */
    private String tleUpdatedAt;
    /** True while the catalog is still downloading this list for the first time; poll again for the rest. */
    private boolean loading;
}
