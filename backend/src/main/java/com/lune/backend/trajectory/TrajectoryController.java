package com.lune.backend.trajectory;

import com.lune.backend.trajectory.dto.TrajectoryRequestDto;
import com.lune.backend.trajectory.dto.TrajectoryResponseDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/trajectory")
@RequiredArgsConstructor
@CrossOrigin(origins = {"http://localhost:3000", "http://127.0.0.1:3000"}, allowCredentials = "true")
public class TrajectoryController {

    private final TrajectoryService trajectoryService;

    /**
     * Plan a trajectory from Earth coordinates to a destination (e.g. Mars).
     * POST body: { "originLat": 28.5, "originLon": -80.6, "destination": "mars", "launchDate": "2026-01-15" }
     */
    @PostMapping(value = "/plan", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<TrajectoryResponseDto> plan(@RequestBody TrajectoryRequestDto request) {
        return ResponseEntity.ok(trajectoryService.computeTrajectory(request));
    }
}
