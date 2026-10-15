package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.OrbitChangeDto;
import com.lune.backend.satellite.dto.OrbitChangesResponseDto;
import com.lune.backend.satellite.dto.OrbitHistoryDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class OrbitChangeService {

    private final TleHistory tleHistory;

    public OrbitChangesResponseDto find(List<Integer> ids) {
        List<OrbitChangeDto> changed = new ArrayList<>();
        int withHistory = 0;
        for (int id : ids) {
            List<TleHistory.Sample> samples = tleHistory.samples(id);
            if (samples.size() >= 2) {
                withHistory++;
            }
            OrbitChangeDetector.detect(id, samples).ifPresent(changed::add);
        }
        Instant since = tleHistory.collectingSince();
        return new OrbitChangesResponseDto(ids.size(), withHistory, since == null ? null : since.toString(), changed);
    }

    /** Stored orbit samples for each satellite that has any (for altitude-over-time charts). */
    public List<OrbitHistoryDto> history(List<Integer> ids) {
        List<OrbitHistoryDto> series = new ArrayList<>();
        for (int id : ids) {
            List<TleHistory.Sample> samples = tleHistory.samples(id);
            if (samples.isEmpty()) {
                continue;
            }
            series.add(new OrbitHistoryDto(id, samples.get(samples.size() - 1).name(), samples.stream()
                    .map(s -> new OrbitHistoryDto.Sample(Instant.ofEpochMilli(s.elements().epochMs()).toString(),
                            Math.round(s.elements().meanAltitudeKm() * 100) / 100.0,
                            Math.round(s.elements().inclinationDeg() * 10_000) / 10_000.0))
                    .toList()));
        }
        return series;
    }
}
