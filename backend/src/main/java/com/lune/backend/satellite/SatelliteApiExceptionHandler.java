package com.lune.backend.satellite;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class SatelliteApiExceptionHandler {

    @ExceptionHandler(SatelliteApiException.class)
    public ResponseEntity<Map<String, String>> handleSatelliteApi(SatelliteApiException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", e.getMessage()));
    }
}
