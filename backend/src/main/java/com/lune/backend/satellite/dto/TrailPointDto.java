package com.lune.backend.satellite.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Single point on a satellite's trail (ECI km) */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TrailPointDto {

    private String datetime;
    private double x;
    private double y;
    private double z;
}
