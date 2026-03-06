package com.lune.backend.satellite.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class TleListParameters {

    @JsonProperty("page")
    private Integer page;

    @JsonProperty("page-size")
    private Integer pageSize;
}
