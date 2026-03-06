package com.lune.backend.satellite.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class TleListResponseDto {

    @JsonProperty("totalItems")
    private Integer totalItems;

    @JsonProperty("member")
    private List<TleDto> member;

    @JsonProperty("parameters")
    private TleListParameters parameters;
}
