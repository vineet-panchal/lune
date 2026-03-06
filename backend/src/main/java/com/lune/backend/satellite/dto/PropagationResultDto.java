package com.lune.backend.satellite.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class PropagationResultDto {

    @JsonProperty("tle")
    private TleDto tle;

    @JsonProperty("vector")
    private VectorDto vector;

    @JsonProperty("geodetic")
    private GeodeticDto geodetic;
}
