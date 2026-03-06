package com.lune.backend.launch;

import com.lune.backend.launch.dto.FutureLaunchDto;
import com.lune.backend.launch.dto.LaunchTrajectoryDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/launches")
@RequiredArgsConstructor
@CrossOrigin(origins = {"http://localhost:3000", "http://127.0.0.1:3000"}, allowCredentials = "true")
public class LaunchController {

    private final LaunchService launchService;

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<FutureLaunchDto>> upcoming(
            @RequestParam(defaultValue = "20") int limit) {
        return ResponseEntity.ok(launchService.getUpcomingLaunches(Math.min(limit, 50)));
    }

    @GetMapping(value = "/{launchId}/trajectory", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LaunchTrajectoryDto> trajectory(@PathVariable String launchId) {
        return launchService.getTrajectory(launchId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
