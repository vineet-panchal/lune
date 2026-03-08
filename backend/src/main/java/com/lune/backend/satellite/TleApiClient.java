package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.PropagationResultDto;
import com.lune.backend.satellite.dto.TleDto;
import com.lune.backend.satellite.dto.TleListResponseDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class TleApiClient {

    private final RestTemplate restTemplate;

    @Value("${lune.tle-api.base-url:https://tle.ivanstanojevic.me}")
    private String baseUrl;

    private static final DateTimeFormatter ISO_FORMAT = DateTimeFormatter.ISO_INSTANT;

    /** Simple in-memory cache for propagation results to avoid hitting TLE API rate limits. */
    private static final long CACHE_TTL_MS = 30_000; // 30 seconds
    private final Map<Integer, CachedResult> propagationCache = new ConcurrentHashMap<>();

    private record CachedResult(PropagationResultDto result, long timestamp) {}

    private void evictStaleEntries() {
        long now = System.currentTimeMillis();
        propagationCache.entrySet().removeIf(e -> now - e.getValue().timestamp() > CACHE_TTL_MS * 2);
    }

    /**
     * Fetch paginated list of satellites (TLE catalog).
     * @param search optional search term (e.g. "ISS", "NOAA", "Starlink") to filter by name
     * @param sort optional sort: "popularity" (default), "name", etc.
     */
    public TleListResponseDto getTleList(int page, int pageSize, String search, String sort) {
        int cappedPageSize = Math.min(pageSize, 100); // TLE API max is 100
        var builder = UriComponentsBuilder.fromUriString(baseUrl + "/api/tle/")
                .queryParam("page", page)
                .queryParam("page-size", cappedPageSize);
        if (search != null && !search.isBlank()) {
            builder.queryParam("search", search.strip());
        }
        if (sort != null && !sort.isBlank()) {
            builder.queryParam("sort", sort.strip());
        }
        URI uri = builder.build().toUri();
        try {
            return restTemplate.getForObject(uri, TleListResponseDto.class);
        } catch (Exception e) {
            log.warn("TLE list request failed: {}", e.getMessage());
            throw new SatelliteApiException("Failed to fetch satellite list", e);
        }
    }

    /**
     * Fetch single TLE by NORAD satellite ID.
     */
    public Optional<TleDto> getTle(int satelliteId) {
        URI uri = UriComponentsBuilder.fromUriString(baseUrl + "/api/tle/" + satelliteId).build().toUri();
        try {
            TleDto dto = restTemplate.getForObject(uri, TleDto.class);
            return Optional.ofNullable(dto);
        } catch (Exception e) {
            log.warn("TLE fetch failed for id {}: {}", satelliteId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Get propagated position at a given instant (UTC).
     * Results are cached for up to 30 s per satellite to stay within TLE API rate limits (500 req/day).
     */
    public Optional<PropagationResultDto> propagate(int satelliteId, Instant instant) {
        // Return cached result if fresh enough
        CachedResult cached = propagationCache.get(satelliteId);
        if (cached != null && System.currentTimeMillis() - cached.timestamp() < CACHE_TTL_MS) {
            return Optional.ofNullable(cached.result());
        }

        String datetime = ISO_FORMAT.format(instant);
        URI uri = UriComponentsBuilder.fromUriString(baseUrl + "/api/tle/" + satelliteId + "/propagate")
                .queryParam("datetime", datetime)
                .build()
                .toUri();
        try {
            PropagationResultDto result = restTemplate.getForObject(uri, PropagationResultDto.class);
            if (result != null) {
                propagationCache.put(satelliteId, new CachedResult(result, System.currentTimeMillis()));
                evictStaleEntries();
            }
            return Optional.ofNullable(result);
        } catch (Exception e) {
            log.warn("Propagate failed for id {} at {}: {}", satelliteId, datetime, e.getMessage());
            // Return stale cache if available rather than empty
            if (cached != null) {
                return Optional.ofNullable(cached.result());
            }
            return Optional.empty();
        }
    }
}
