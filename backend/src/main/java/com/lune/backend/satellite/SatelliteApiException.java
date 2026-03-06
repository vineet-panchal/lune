package com.lune.backend.satellite;

public class SatelliteApiException extends RuntimeException {

    public SatelliteApiException(String message) {
        super(message);
    }

    public SatelliteApiException(String message, Throwable cause) {
        super(message, cause);
    }
}
