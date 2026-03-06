package com.lune.backend.trajectory;

import com.lune.backend.trajectory.dto.TrajectoryRequestDto;
import com.lune.backend.trajectory.dto.TrajectoryResponseDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Earth–Mars (and later other) trajectory calculation.
 * Stub: returns a simplified path; production would use ephemeris (e.g. NASA SPICE, or simplified Hohmann).
 */
@Service
@Slf4j
public class TrajectoryService {

    private static final double EARTH_RADIUS_KM = 6371;
    private static final double MARS_ORBIT_KM = 227.9e6; // approx semi-major axis
    private static final double TYPICAL_TRANSFER_DAYS = 260; // ballpark for Earth–Mars

    public TrajectoryResponseDto computeTrajectory(TrajectoryRequestDto request) {
        if (request.getDestination() == null || !request.getDestination().equalsIgnoreCase("mars")) {
            return TrajectoryResponseDto.builder()
                    .destination(request.getDestination())
                    .originLat(request.getOriginLat())
                    .originLon(request.getOriginLon())
                    .launchDate(request.getLaunchDate())
                    .transferDays(0)
                    .pathPoints(List.of())
                    .build();
        }

        // Stub path: a few points from Earth surface (lat/lon to ECI-like) toward Mars.
        // Frontend can interpret as line from origin to destination.
        List<double[]> path = new ArrayList<>();
        path.add(new double[]{ request.getOriginLon(), request.getOriginLat(), 0 }); // surface
        path.add(new double[]{ request.getOriginLon(), request.getOriginLat(), 500 }); // LEO
        path.add(new double[]{ request.getOriginLon() + 20, request.getOriginLat() + 5, 10000 });
        path.add(new double[]{ 0, 0, MARS_ORBIT_KM / 1000 }); // placeholder Mars distance

        return TrajectoryResponseDto.builder()
                .destination("mars")
                .originLat(request.getOriginLat())
                .originLon(request.getOriginLon())
                .launchDate(request.getLaunchDate())
                .transferDays(TYPICAL_TRANSFER_DAYS)
                .pathPoints(path)
                .build();
    }
}
