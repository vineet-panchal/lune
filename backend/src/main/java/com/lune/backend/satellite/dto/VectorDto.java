package com.lune.backend.satellite.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class VectorDto {

    @JsonProperty("reference_frame")
    private String referenceFrame;

    @JsonProperty("position")
    private CartesianDto position;

    @JsonProperty("velocity")
    private CartesianDto velocity;
}
