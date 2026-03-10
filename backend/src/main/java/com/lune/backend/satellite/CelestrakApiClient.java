package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class CelestrakApiClient {

    private static final String BASE_URL = "https://celestrak.org/NORAD/elements/gp.php";
    private static final long GROUP_CACHE_TTL_MS = 3600_000; // 1 hour

    private final RestTemplate restTemplate;

    private record CachedGroup(List<CelestrakSatelliteDto> data, long fetchedAt) {}
    private final Map<String, CachedGroup> groupCache = new ConcurrentHashMap<>();

    /**
     * Fetch satellites by CelesTrak group name (e.g. "STARLINK", "GPS-OPS", "STATIONS").
     * Returns an empty list on failure.
     */
    public List<CelestrakSatelliteDto> getGroup(String group) {
        String key = group.toUpperCase();
        CachedGroup cached = groupCache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < GROUP_CACHE_TTL_MS) {
            return cached.data();
        }
        URI uri = UriComponentsBuilder.fromUriString(BASE_URL)
                .queryParam("GROUP", group.toUpperCase())
                .queryParam("FORMAT", "3le")
                .build()
                .toUri();
        try {
            String body = restTemplate.getForObject(uri, String.class);
            if (body == null || body.isBlank()) return List.of();
            String[] lines = body.strip().split("\\r?\\n");
            List<CelestrakSatelliteDto> result = new ArrayList<>();
            for (int i = 0; i + 2 < lines.length; i += 3) {
                String nameLine = lines[i].trim();
                String l1 = lines[i + 1].trim();
                String l2 = lines[i + 2].trim();
                if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
                CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
                dto.setName(nameLine.startsWith("0 ") ? nameLine.substring(2).trim() : nameLine);
                dto.setLine1(l1);
                dto.setLine2(l2);
                try {
                    dto.setNoradCatId(Integer.parseInt(l1.substring(2, 7).trim()));
                } catch (NumberFormatException e) {
                    continue;
                }
                result.add(dto);
            }
            groupCache.put(key, new CachedGroup(result, System.currentTimeMillis()));
            return result;
        } catch (Exception e) {
            log.warn("CelesTrak group fetch failed for '{}': {}", group, e.getMessage());
            return List.of();
        }
    }

    /**
     * Fetch a single satellite's TLE by NORAD catalog ID from CelesTrak.
     * Returns name, line1, line2 parsed from TLE text format.
     */
    public Optional<CelestrakSatelliteDto> getSatellite(int noradId) {
        URI uri = UriComponentsBuilder.fromUriString(BASE_URL)
                .queryParam("CATNR", noradId)
                .queryParam("FORMAT", "TLE")
                .build()
                .toUri();
        try {
            String body = restTemplate.getForObject(uri, String.class);
            if (body == null || body.isBlank()) return Optional.empty();
            String[] lines = body.strip().split("\\r?\\n");
            if (lines.length < 3) return Optional.empty();

            CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
            dto.setName(lines[0].trim());
            dto.setNoradCatId(noradId);
            dto.setLine1(lines[1].trim());
            dto.setLine2(lines[2].trim());
            return Optional.of(dto);
        } catch (Exception e) {
            log.warn("CelesTrak single satellite fetch failed for {}: {}", noradId, e.getMessage());
            return Optional.empty();
        }
    }
}
