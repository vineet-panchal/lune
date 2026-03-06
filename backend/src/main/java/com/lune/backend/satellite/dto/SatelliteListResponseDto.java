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
}
