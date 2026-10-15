package com.lune.backend.mission;

import com.lune.backend.mission.dto.CatalogPulseDto;
import com.lune.backend.satellite.OrbitChangeService;
import com.lune.backend.satellite.SatelliteCatalog;
import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import com.lune.backend.satellite.dto.OrbitChangeDto;
import com.lune.backend.satellite.dto.OrbitChangesResponseDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Mission Control's "what Lune sees" card, from the active-satellite catalog (CelesTrak's ACTIVE group, loaded on
 * first use and refreshed like any other group) and the TLE history recorded on each refresh.
 */
@Service
@RequiredArgsConstructor
public class CatalogPulseService {

    private static final String ACTIVE_KEY = SatelliteCatalog.groupKey("ACTIVE");
    private static final long MANOEUVRE_WINDOW_MS = 7 * 86_400_000L;
    private static final int MAX_REENTRIES = 8;
    private static final int MAX_MANOEUVRES = 12;
    private static final int MAX_LAUNCHES = 40;
    private static final int EXAMPLE_NAMES = 3;

    private final SatelliteCatalog catalog;
    private final OrbitChangeService orbitChangeService;

    public CatalogPulseDto pulse() {
        SatelliteCatalog.Snapshot snapshot = catalog.get(ACTIVE_KEY);
        List<CelestrakSatelliteDto> satellites = snapshot == null ? List.of() : snapshot.satellites();
        boolean loading = snapshot == null || (!snapshot.complete() && catalog.isLoading(ACTIVE_KEY));
        OrbitChangesResponseDto changes = orbitChangeService.find(
                satellites.stream().map(CelestrakSatelliteDto::getNoradCatId).toList());

        List<OrbitChangeDto> reentries = changes.satellites().stream()
                .filter(c -> c.decaying() && c.daysToReentry() != null)
                .sorted(Comparator.comparingDouble(OrbitChangeDto::daysToReentry))
                .limit(MAX_REENTRIES)
                .toList();

        long since = System.currentTimeMillis() - MANOEUVRE_WINDOW_MS;
        Map<String, Integer> counts = new LinkedHashMap<>(Map.of("raise", 0, "lower", 0, "plane_change", 0));
        List<CatalogPulseDto.Manoeuvre> manoeuvres = new ArrayList<>();
        for (OrbitChangeDto c : changes.satellites()) {
            c.events().stream()
                    .filter(e -> Instant.parse(e.to()).toEpochMilli() >= since)
                    .forEach(e -> {
                        counts.merge(e.type(), 1, Integer::sum);
                        manoeuvres.add(new CatalogPulseDto.Manoeuvre(c.satelliteId(), c.name(), e.type(), e.to(),
                                e.deltaAltitudeKm(), e.deltaInclinationDeg(), c.latestAltitudeKm()));
                    });
        }
        manoeuvres.sort(Comparator.comparing(CatalogPulseDto.Manoeuvre::at).reversed());

        return new CatalogPulseDto(
                satellites.size(),
                snapshot == null ? null : Instant.ofEpochMilli(snapshot.updatedAt()).toString(),
                loading,
                changes.historySince(),
                changes.withHistory(),
                reentries,
                counts,
                manoeuvres.subList(0, Math.min(MAX_MANOEUVRES, manoeuvres.size())),
                newestLaunches(satellites));
    }

    /** Satellites grouped by the launch that carried them, newest launch first. */
    private static List<CatalogPulseDto.LaunchObjects> newestLaunches(List<CelestrakSatelliteDto> satellites) {
        TreeMap<String, List<CelestrakSatelliteDto>> byLaunch = new TreeMap<>(Comparator.reverseOrder());
        for (CelestrakSatelliteDto s : satellites) {
            String launch = launchDesignator(s.getLine1());
            if (launch != null) {
                byLaunch.computeIfAbsent(launch, k -> new ArrayList<>()).add(s);
            }
        }
        return byLaunch.entrySet().stream()
                .limit(MAX_LAUNCHES)
                .map(e -> new CatalogPulseDto.LaunchObjects(
                        e.getKey(),
                        e.getValue().size(),
                        e.getValue().stream().map(CelestrakSatelliteDto::getName).sorted().limit(EXAMPLE_NAMES).toList(),
                        e.getValue().stream().map(CelestrakSatelliteDto::getNoradCatId).sorted().toList()))
                .toList();
    }

    /**
     * TLE line 1, columns 10–14: 2-digit launch year and the launch number that year, as Launch Library writes it
     * ("2026-234"). Null for objects without one.
     */
    static String launchDesignator(String line1) {
        if (line1 == null || line1.length() < 17) {
            return null;
        }
        try {
            int yy = Integer.parseInt(line1.substring(9, 11).trim());
            String number = line1.substring(11, 14).trim();
            if (number.length() != 3) {
                return null;
            }
            return (yy < 57 ? 2000 + yy : 1900 + yy) + "-" + number;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
