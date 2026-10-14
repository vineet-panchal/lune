package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

/**
 * Every distinct TLE the catalog has seen for each satellite, oldest first, so orbit changes (manoeuvres,
 * decay) can be found by comparing a satellite with its earlier self. The catalog keeps only the latest TLE;
 * this keeps the ones before it.
 *
 * History only grows while the backend runs: each catalog refresh (every 2 h from CelesTrak, 6 h from the
 * TLE API) adds a sample for every satellite whose TLE has a new epoch. Stored as an append-only 3LE file,
 * compacted on startup.
 */
@Component
@Slf4j
public class TleHistory {

    /** Enough for weeks of refreshes per satellite; older samples are dropped first. */
    private static final int MAX_SAMPLES_PER_SATELLITE = 60;
    private static final long MAX_AGE_MS = 90L * 86_400_000L;

    /** One stored TLE. */
    public record Sample(String name, String line1, String line2, TleElements elements) {}

    private static final String SINCE_HEADER = "# collecting-since=";

    private final Map<Integer, NavigableMap<Long, Sample>> bySatellite = new HashMap<>();
    /** When this history file was started: samples can only be compared from then on. */
    private Instant collectingSince;

    @Value("${lune.history.file:${user.home}/.lune/tle-history.3le}")
    private Path file;

    @PostConstruct
    void init() {
        if (!Files.isRegularFile(file)) {
            return;
        }
        try {
            String text = Files.readString(file, StandardCharsets.UTF_8);
            List<CelestrakSatelliteDto> saved = CelestrakApiClient.parse3le(text);
            synchronized (this) {
                collectingSince = text.startsWith(SINCE_HEADER)
                        ? Instant.parse(text.lines().findFirst().orElseThrow().substring(SINCE_HEADER.length()).trim())
                        : Files.getLastModifiedTime(file).toInstant();
                saved.forEach(this::add);
            }
            compactFile();
            log.info("TLE history: {} samples for {} satellites", sampleCount(), bySatellite.size());
        } catch (IOException e) {
            log.warn("Could not read TLE history {}: {}", file, e.getMessage());
        }
    }

    /**
     * Store any TLEs with an epoch not seen before for their satellite. Synchronized as a whole (file write
     * included) so concurrent catalog loaders don't interleave lines in the file.
     */
    public synchronized void record(List<CelestrakSatelliteDto> satellites) {
        List<CelestrakSatelliteDto> added = new ArrayList<>();
        for (CelestrakSatelliteDto s : satellites) {
            if (add(s)) {
                added.add(s);
            }
        }
        if (!added.isEmpty()) {
            append(added);
        }
    }

    /** Samples for one satellite, oldest first (empty if none). */
    public synchronized List<Sample> samples(int noradId) {
        NavigableMap<Long, Sample> samples = bySatellite.get(noradId);
        return samples == null ? List.of() : List.copyOf(samples.values());
    }

    /** When the backend started recording history, or null if nothing has been recorded yet. */
    public synchronized Instant collectingSince() {
        return collectingSince;
    }

    private boolean add(CelestrakSatelliteDto s) {
        if (s.getNoradCatId() == null) {
            return false;
        }
        TleElements elements = TleElements.parse(s.getLine1(), s.getLine2()).orElse(null);
        if (elements == null || elements.epochMs() < System.currentTimeMillis() - MAX_AGE_MS) {
            return false;
        }
        NavigableMap<Long, Sample> samples = bySatellite.computeIfAbsent(s.getNoradCatId(), id -> new TreeMap<>());
        if (samples.putIfAbsent(elements.epochMs(), new Sample(s.getName(), s.getLine1(), s.getLine2(), elements)) != null) {
            return false;
        }
        while (samples.size() > MAX_SAMPLES_PER_SATELLITE) {
            samples.pollFirstEntry();
        }
        return true;
    }

    private int sampleCount() {
        return bySatellite.values().stream().mapToInt(Map::size).sum();
    }

    private void append(List<CelestrakSatelliteDto> added) {
        try {
            Files.createDirectories(file.getParent());
            String header = "";
            if (collectingSince == null) {
                collectingSince = Instant.now();
                header = SINCE_HEADER + collectingSince + "\n";
            }
            Files.writeString(file, header + CelestrakApiClient.format3le(added), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            log.warn("Could not append to TLE history {}: {}", file, e.getMessage());
        }
    }

    /** Rewrite the file with only what's kept in memory (drops duplicates, old and over-limit samples). */
    private void compactFile() {
        List<CelestrakSatelliteDto> kept = new ArrayList<>();
        synchronized (this) {
            bySatellite.forEach((id, samples) -> samples.values().forEach(sample -> {
                CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
                dto.setNoradCatId(id);
                dto.setName(sample.name());
                dto.setLine1(sample.line1());
                dto.setLine2(sample.line2());
                kept.add(dto);
            }));
        }
        try {
            Path tmp = Files.createTempFile(file.getParent(), "tle-history", ".tmp");
            Files.writeString(tmp, SINCE_HEADER + collectingSince + "\n" + CelestrakApiClient.format3le(kept), StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            log.warn("Could not compact TLE history {}: {}", file, e.getMessage());
        }
    }
}
