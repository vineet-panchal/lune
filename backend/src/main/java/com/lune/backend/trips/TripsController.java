package com.lune.backend.trips;

import com.lune.backend.mission.FeedCache;
import com.lune.backend.trips.dto.MoonElementsDto;
import com.lune.backend.trips.dto.TrajectoryDto;
import com.lune.backend.trips.dto.TripLaunchDto;
import com.lune.backend.trips.dto.TripMissionDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Trips: real interplanetary missions and their paths. Planned trips (transfers, launch vehicles, fuel) are
 * worked out in the browser; this only serves what has to come from outside: JPL's paths and moon orbits, and
 * Launch Library's upcoming launches to planets and moons.
 */
@RestController
@RequestMapping(value = "/api/trips", produces = MediaType.APPLICATION_JSON_VALUE)
@RequiredArgsConstructor
@CrossOrigin(origins = {"http://localhost:3000", "http://127.0.0.1:3000"}, allowCredentials = "true")
public class TripsController {

    private final HorizonsTrajectories trajectories;
    private final MoonEphemerides moons;
    private final TripLaunches launches;

    @GetMapping("/missions")
    public List<TripMissionDto> missions() {
        return TripMissions.ALL.stream().map(TripMissions.Mission::info).toList();
    }

    /** Answers at once from memory; loading=true means part of the path is still downloading, so ask again. */
    @GetMapping("/missions/{id}/trajectory")
    public ResponseEntity<?> trajectory(@PathVariable String id) {
        TripMissions.Mission mission = TripMissions.byId(id);
        if (mission == null) {
            return ResponseEntity.status(404).body(Map.of("error", "Unknown mission " + id));
        }
        FeedCache.Result<TrajectoryDto> result = trajectories.trajectory(mission);
        return ResponseEntity.ok(result);
    }

    /** A moon's orbital elements for one UTC year (Horizons moons only; astronomy-engine covers the rest). */
    @GetMapping("/moons/{id}/elements")
    public ResponseEntity<?> moonElements(@PathVariable String id, @RequestParam int year) {
        if (!MoonEphemerides.known(id)) {
            return ResponseEntity.status(404).body(Map.of("error", "No Horizons orbit for moon " + id));
        }
        FeedCache.Result<MoonElementsDto> result = moons.elements(id, year);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/launches")
    public FeedCache.Result<List<TripLaunchDto>> launches() {
        return launches.upcoming();
    }
}
