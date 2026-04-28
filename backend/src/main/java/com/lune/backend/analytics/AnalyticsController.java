package com.lune.backend.analytics;

import com.lune.backend.analytics.dto.ClusterRequestDto;
import com.lune.backend.analytics.dto.ClusterResponseDto;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/analytics")
@CrossOrigin(origins = {"http://localhost:3000", "http://127.0.0.1:3000"}, allowCredentials = "true")
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    public AnalyticsController(AnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    @PostMapping("/cluster")
    public ResponseEntity<?> cluster(@RequestBody ClusterRequestDto body) {
        if (body.points() == null || body.points().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No points supplied"));
        }
        try {
            ClusterResponseDto result = analyticsService.cluster(body);
            return ResponseEntity.ok(result);
        }
        catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
