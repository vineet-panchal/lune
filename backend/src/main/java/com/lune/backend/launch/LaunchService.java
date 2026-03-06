package com.lune.backend.launch;

import com.lune.backend.launch.dto.FutureLaunchDto;
import com.lune.backend.launch.dto.LaunchTrajectoryDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Future space launches and mission trajectories.
 * Stub implementation; can be wired to Launch Library 2 API (ll.thespacedevs.com) or NASA.
 */
@Service
@Slf4j
public class LaunchService {

    public List<FutureLaunchDto> getUpcomingLaunches(int limit) {
        // Stub: return a few well-known upcoming missions. Replace with API client.
        return List.of(
                FutureLaunchDto.builder()
                        .id("artemis-3")
                        .name("Artemis III")
                        .description("NASA crewed lunar landing mission")
                        .agency("NASA")
                        .rocket("Space Launch System")
                        .windowStart(Instant.parse("2026-09-01T00:00:00Z"))
                        .windowEnd(Instant.parse("2026-12-31T23:59:59Z"))
                        .destination("Moon")
                        .missionType("crewed")
                        .build(),
                FutureLaunchDto.builder()
                        .id("starship-mars-demo")
                        .name("Starship Mars Demo")
                        .description("SpaceX Starship test / Mars precursor")
                        .agency("SpaceX")
                        .rocket("Starship")
                        .windowStart(Instant.parse("2026-01-01T00:00:00Z"))
                        .windowEnd(Instant.parse("2027-12-31T23:59:59Z"))
                        .destination("Mars")
                        .missionType("uncrewed")
                        .build()
        ).stream().limit(limit).toList();
    }

    public Optional<LaunchTrajectoryDto> getTrajectory(String launchId) {
        if ("artemis-3".equals(launchId)) {
            return Optional.of(LaunchTrajectoryDto.builder()
                    .launchId(launchId)
                    .missionName("Artemis III")
                    .originName("Kennedy Space Center")
                    .originLat(28.5729)
                    .originLon(-80.6490)
                    .destinationName("Moon")
                    .destinationLat(0)  // placeholder; frontend can use Moon position
                    .destinationLon(0)
                    .pathSegments(null) // TODO: add simplified translunar path points
                    .build());
        }
        return Optional.empty();
    }
}
