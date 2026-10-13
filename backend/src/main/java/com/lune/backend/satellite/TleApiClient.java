package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.PropagationResultDto;
import com.lune.backend.satellite.dto.TleDto;
import com.lune.backend.satellite.dto.TleListParameters;
import com.lune.backend.satellite.dto.TleListResponseDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Slf4j
public class TleApiClient {

    private static final int BULK_PAGE_SIZE = 100; // TLE API max
    // The TLE API is a small shared host that answers bursts with 508 "Resource Limit Is Reached".
    private static final long BULK_PAGE_DELAY_MS = 1_500;
    private static final long BULK_RETRY_WAIT_MS = 30_000;
    private static final int BULK_MAX_RETRIES = 5;

    private final RestTemplate restTemplate;
    private final RestTemplate bulkRestTemplate;
    /** Shared across all bulk loads so concurrent catalog refreshes interleave pages instead of bursting. */
    private long nextBulkRequestAt = 0;

    public TleApiClient(RestTemplate restTemplate, @Qualifier("bulkRestTemplate") RestTemplate bulkRestTemplate) {
        this.restTemplate = restTemplate;
        this.bulkRestTemplate = bulkRestTemplate;
    }

    public record BulkResult(List<TleDto> items, boolean complete) {}

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
            log.warn("TLE list request failed for '{}': {}", uri, e.getMessage());
            return emptyListResponse(page, cappedPageSize);
        }
    }

    /**
     * Download every TLE matching a search term, one page at a time with a pause between pages.
     * Rate-limit errors wait and retry the same page. onProgress receives the accumulated list after each page.
     * Meant for background refreshes only: a large group (e.g. Starlink) takes several minutes.
     */
    public BulkResult fetchAll(String search, Consumer<List<TleDto>> onProgress) {
        List<TleDto> items = new ArrayList<>();
        int page = 1;
        int failures = 0;
        while (true) {
            URI uri = UriComponentsBuilder.fromUriString(baseUrl + "/api/tle/")
                    .queryParam("page", page)
                    .queryParam("page-size", BULK_PAGE_SIZE)
                    .queryParam("search", search)
                    .queryParam("sort", "id") // stable order so pages don't shift while we walk them
                    .build()
                    .toUri();
            TleListResponseDto resp;
            try {
                awaitBulkSlot();
                resp = bulkRestTemplate.getForObject(uri, TleListResponseDto.class);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return new BulkResult(items, false);
            } catch (RestClientException e) {
                if (++failures > BULK_MAX_RETRIES) {
                    log.warn("TLE API bulk fetch for '{}' gave up at page {} ({} loaded): {}", search, page, items.size(), e.getMessage());
                    return new BulkResult(items, false);
                }
                log.info("TLE API bulk fetch for '{}' page {} failed, retrying in {}s: {}",
                        search, page, BULK_RETRY_WAIT_MS * failures / 1000, abbreviate(e.getMessage()));
                delayBulkRequests(BULK_RETRY_WAIT_MS * failures);
                continue;
            }
            failures = 0;

            List<TleDto> members = resp != null && resp.getMember() != null ? resp.getMember() : List.of();
            for (TleDto tle : members) {
                if (tle.getSatelliteId() != null && tle.getLine1() != null && tle.getLine2() != null) {
                    items.add(tle);
                }
            }
            onProgress.accept(items);

            int total = resp != null && resp.getTotalItems() != null ? resp.getTotalItems() : 0;
            if (members.size() < BULK_PAGE_SIZE || page * BULK_PAGE_SIZE >= total) {
                return new BulkResult(items, true);
            }
            page++;
        }
    }

    private void awaitBulkSlot() throws InterruptedException {
        long wait;
        synchronized (this) {
            long now = System.currentTimeMillis();
            long slot = Math.max(now, nextBulkRequestAt);
            nextBulkRequestAt = slot + BULK_PAGE_DELAY_MS;
            wait = slot - now;
        }
        if (wait > 0) {
            Thread.sleep(wait);
        }
    }

    /** After a rate-limit error, hold back every bulk loader, not just the one that hit it. */
    private synchronized void delayBulkRequests(long delayMs) {
        nextBulkRequestAt = Math.max(nextBulkRequestAt, System.currentTimeMillis() + delayMs);
    }

    private static String abbreviate(String message) {
        return message != null && message.length() > 120 ? message.substring(0, 120) + "..." : message;
    }

    private TleListResponseDto emptyListResponse(int page, int pageSize) {
        TleListParameters parameters = new TleListParameters();
        parameters.setPage(page);
        parameters.setPageSize(pageSize);

        TleListResponseDto dto = new TleListResponseDto();
        dto.setTotalItems(0);
        dto.setMember(Collections.emptyList());
        dto.setParameters(parameters);
        return dto;
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
