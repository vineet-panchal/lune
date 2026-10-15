package com.lune.backend.analytics;

import com.lune.backend.analytics.dto.ClusterRequestDto;
import com.lune.backend.analytics.dto.ClusterResponseDto;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
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

    /** 200 {"status":"ok"} when the Python service is reachable, 503 {"status":"unavailable"} otherwise. */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return analyticsService.isHealthy()
                ? ResponseEntity.ok(Map.of("status", "ok"))
                : ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("status", "unavailable"));
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

    /** Settings helpers for the models; see the analytics service's /sweep. */
    @PostMapping(value = "/sweep", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> sweep(@RequestBody String body) {
        return passThrough(() -> analyticsService.sweep(body));
    }

    /** The model's view in 2D; see the analytics service's /project. */
    @PostMapping(value = "/project", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> project(@RequestBody String body) {
        return passThrough(() -> analyticsService.project(body));
    }

    /** Close-approach screening; see the analytics service's /conjunctions. */
    @PostMapping(value = "/conjunctions", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> conjunctions(@RequestBody String body) {
        return passThrough(() -> analyticsService.conjunctions(body));
    }

    private ResponseEntity<?> passThrough(java.util.function.Supplier<String> call) {
        try {
            return ResponseEntity.ok(call.get());
        }
        catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
