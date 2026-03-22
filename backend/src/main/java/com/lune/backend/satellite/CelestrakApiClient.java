package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class CelestrakApiClient {

    private static final List<String> BASE_URLS = List.of(
            "https://celestrak.org/NORAD/elements/gp.php",
            "https://www.celestrak.com/NORAD/elements/gp.php"
    );
    private static final long GROUP_CACHE_TTL_MS = 3600_000; // 1 hour
    private static final int REQUEST_RETRIES = 1;
    private static final long RETRY_DELAY_MS = 250;
    private static final long OUTAGE_BACKOFF_MS = 120_000;
    private static final String USER_AGENT = "lune-backend/1.0 (satellite-tracker)";

    private final RestTemplate restTemplate;
    private volatile long celestrakUnavailableUntilMs = 0;

    private record CachedGroup(List<CelestrakSatelliteDto> data, long fetchedAt) {}
    private final Map<String, CachedGroup> groupCache = new ConcurrentHashMap<>();

    /**
     * Fetch satellites by CelesTrak group name (e.g. "STARLINK", "GPS-OPS", "STATIONS").
     * Returns an empty list on failure.
     */
    public List<CelestrakSatelliteDto> getGroup(String group) {
        if (isTemporarilyUnavailable()) {
            return List.of();
        }
        String key = group.toUpperCase();
        CachedGroup cached = groupCache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < GROUP_CACHE_TTL_MS) {
            return cached.data();
        }
        List<CelestrakSatelliteDto> result = fetchGroupFromJson(group);
        if (result.isEmpty()) {
            result = fetchGroupFromText(group);
        }
        if (!result.isEmpty()) {
            markAvailable();
            groupCache.put(key, new CachedGroup(result, System.currentTimeMillis()));
        } else {
            markTemporarilyUnavailable();
        }
        return result;
    }

    /**
     * Fetch a single satellite's TLE by NORAD catalog ID from CelesTrak.
     * Returns name, line1, line2 parsed from TLE text format.
     */
    public Optional<CelestrakSatelliteDto> getSatellite(int noradId) {
        if (isTemporarilyUnavailable()) {
            return Optional.empty();
        }
        Optional<CelestrakSatelliteDto> fromJson = fetchSatelliteFromJson(noradId);
        if (fromJson.isPresent()) {
            markAvailable();
            return fromJson;
        }
        Optional<CelestrakSatelliteDto> fromText = fetchSatelliteFromText(noradId);
        if (fromText.isPresent()) {
            markAvailable();
        } else {
            markTemporarilyUnavailable();
        }
        return fromText;
    }

    private Optional<CelestrakSatelliteDto> fetchSatelliteFromJson(int noradId) {
        for (String baseUrl : BASE_URLS) {
            URI uri = UriComponentsBuilder.fromUriString(baseUrl)
                    .queryParam("CATNR", noradId)
                    .queryParam("FORMAT", "json")
                    .build()
                    .toUri();
            for (int attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
                try {
                    ResponseEntity<List<CelestrakSatelliteDto>> response = restTemplate.exchange(
                            uri,
                            HttpMethod.GET,
                            new HttpEntity<>(buildHeaders()),
                            new ParameterizedTypeReference<>() {}
                    );
                    List<CelestrakSatelliteDto> body = response.getBody();
                    if (body == null || body.isEmpty()) {
                        continue;
                    }
                    CelestrakSatelliteDto first = body.get(0);
                    if (first.getNoradCatId() != null && first.getLine1() != null && first.getLine2() != null) {
                        return Optional.of(first);
                    }
                } catch (Exception e) {
                    maybePauseBeforeRetry(attempt);
                    log.debug("CelesTrak JSON satellite fetch failed for {} via {} (attempt {}/{}): {}",
                            noradId, baseUrl, attempt, REQUEST_RETRIES, e.getMessage());
                }
            }
        }
        return Optional.empty();
    }

    private Optional<CelestrakSatelliteDto> fetchSatelliteFromText(int noradId) {
        for (String baseUrl : BASE_URLS) {
            URI uri = UriComponentsBuilder.fromUriString(baseUrl)
                    .queryParam("CATNR", noradId)
                    .queryParam("FORMAT", "TLE")
                    .build()
                    .toUri();
            for (int attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
                try {
                    String body = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<>(buildHeaders()), String.class).getBody();
                    Optional<CelestrakSatelliteDto> parsed = parseTextTle(body, noradId);
                    if (parsed.isPresent()) {
                        return parsed;
                    }
                } catch (Exception e) {
                    maybePauseBeforeRetry(attempt);
                    log.debug("CelesTrak text satellite fetch failed for {} via {} (attempt {}/{}): {}",
                            noradId, baseUrl, attempt, REQUEST_RETRIES, e.getMessage());
                }
            }
        }
        log.warn("CelesTrak single satellite fetch failed for {} across all endpoints", noradId);
        return Optional.empty();
    }

    private List<CelestrakSatelliteDto> fetchGroupFromJson(String group) {
        for (String baseUrl : BASE_URLS) {
            URI uri = UriComponentsBuilder.fromUriString(baseUrl)
                    .queryParam("GROUP", group.toUpperCase())
                    .queryParam("FORMAT", "json")
                    .build()
                    .toUri();
            for (int attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
                try {
                    ResponseEntity<List<CelestrakSatelliteDto>> response = restTemplate.exchange(
                            uri,
                            HttpMethod.GET,
                            new HttpEntity<>(buildHeaders()),
                            new ParameterizedTypeReference<>() {}
                    );
                    List<CelestrakSatelliteDto> body = response.getBody();
                    if (body == null || body.isEmpty()) {
                        continue;
                    }
                    List<CelestrakSatelliteDto> valid = body.stream()
                            .filter(s -> s.getNoradCatId() != null && s.getLine1() != null && s.getLine2() != null)
                            .toList();
                    if (!valid.isEmpty()) {
                        return valid;
                    }
                } catch (Exception e) {
                    maybePauseBeforeRetry(attempt);
                    log.debug("CelesTrak JSON group fetch failed for '{}' via {} (attempt {}/{}): {}",
                            group, baseUrl, attempt, REQUEST_RETRIES, e.getMessage());
                }
            }
        }
        return List.of();
    }

    private List<CelestrakSatelliteDto> fetchGroupFromText(String group) {
        for (String baseUrl : BASE_URLS) {
            URI uri = UriComponentsBuilder.fromUriString(baseUrl)
                    .queryParam("GROUP", group.toUpperCase())
                    .queryParam("FORMAT", "3le")
                    .build()
                    .toUri();
            for (int attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
                try {
                    String body = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<>(buildHeaders()), String.class).getBody();
                    List<CelestrakSatelliteDto> parsed = parseTextGroup(body);
                    if (!parsed.isEmpty()) {
                        return parsed;
                    }
                } catch (Exception e) {
                    maybePauseBeforeRetry(attempt);
                    log.debug("CelesTrak text group fetch failed for '{}' via {} (attempt {}/{}): {}",
                            group, baseUrl, attempt, REQUEST_RETRIES, e.getMessage());
                }
            }
        }
        log.warn("CelesTrak group fetch failed/empty for '{}' across all endpoints", group);
        return List.of();
    }

    private List<CelestrakSatelliteDto> parseTextGroup(String body) {
        if (body == null || body.isBlank()) {
            return List.of();
        }
        if (body.stripLeading().startsWith("<")) {
            return List.of();
        }

        String[] lines = body.strip().split("\\r?\\n");
        List<CelestrakSatelliteDto> result = new ArrayList<>();

        for (int i = 0; i + 2 < lines.length; i += 3) {
            String nameLine = lines[i].trim();
            String l1 = lines[i + 1].trim();
            String l2 = lines[i + 2].trim();
            if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) {
                continue;
            }
            CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
            dto.setName(nameLine.startsWith("0 ") ? nameLine.substring(2).trim() : nameLine);
            dto.setLine1(l1);
            dto.setLine2(l2);
            try {
                dto.setNoradCatId(Integer.parseInt(l1.substring(2, 7).trim()));
            } catch (RuntimeException e) {
                continue;
            }
            result.add(dto);
        }
        return result;
    }

    private Optional<CelestrakSatelliteDto> parseTextTle(String body, int noradId) {
        if (body == null || body.isBlank()) {
            return Optional.empty();
        }
        if (body.stripLeading().startsWith("<")) {
            return Optional.empty();
        }

        String[] lines = Arrays.stream(body.strip().split("\\r?\\n"))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .toArray(String[]::new);

        if (lines.length < 2) {
            return Optional.empty();
        }

        String name = null;
        String l1 = null;
        String l2 = null;
        for (String line : lines) {
            if (line.startsWith("1 ") && l1 == null) {
                l1 = line;
            } else if (line.startsWith("2 ") && l2 == null) {
                l2 = line;
            } else if (name == null) {
                name = line.startsWith("0 ") ? line.substring(2).trim() : line;
            }
        }

        if (l1 == null || l2 == null) {
            return Optional.empty();
        }

        CelestrakSatelliteDto dto = new CelestrakSatelliteDto();
        dto.setName(name);
        dto.setNoradCatId(noradId);
        dto.setLine1(l1);
        dto.setLine2(l2);
        return Optional.of(dto);
    }

    private HttpHeaders buildHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.USER_AGENT, USER_AGENT);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN, MediaType.ALL));
        return headers;
    }

    private void maybePauseBeforeRetry(int attempt) {
        if (attempt >= REQUEST_RETRIES) {
            return;
        }
        try {
            Thread.sleep(RETRY_DELAY_MS);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    private boolean isTemporarilyUnavailable() {
        return System.currentTimeMillis() < celestrakUnavailableUntilMs;
    }

    private void markTemporarilyUnavailable() {
        celestrakUnavailableUntilMs = System.currentTimeMillis() + OUTAGE_BACKOFF_MS;
    }

    private void markAvailable() {
        celestrakUnavailableUntilMs = 0;
    }
}
