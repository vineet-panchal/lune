package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.OrbitChangeDto;
import com.lune.backend.satellite.dto.OrbitChangesResponseDto;
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
}
