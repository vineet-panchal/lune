package com.lune.backend.mission;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

/**
 * Outside JSON feeds for Mission Control (news, launches, space weather, ...), cached like the TLE catalog:
 * requests never wait on an upstream. A missing or stale feed is queued for a background download and the caller
 * gets what's in memory now (loading=true until it arrives). Each download is written to disk, so restarts don't
 * re-download, which matters for Launch Library's 15 requests an hour.
 */
@Component
@Slf4j
public class FeedCache {

    /** After a failure (including a 429 rate limit), leave that host alone for this long. */
    private static final long FAILURE_BACKOFF_MS = 15 * 60_000L;
    private static final String USER_AGENT = "lune-backend/1.0 (mission-control)";

    /**
     * One outside feed: where to download it, how often, and how to turn the JSON into what the UI gets.
     * The parser should throw if the JSON isn't what it expects, so a broken answer never replaces a good one.
     */
    public record Spec<T>(String name, String url, long refreshMs, Function<JsonNode, T> parser) {}

    /** What an endpoint returns: the data (null until the first download), when it was downloaded, and status. */
    public record Result<T>(T data, String updatedAt, boolean loading, String error) {}

    private record Entry(Object data, long fetchedAt) {}

    private final RestTemplate restTemplate;
    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final Map<String, String> errors = new ConcurrentHashMap<>();
    private final Map<String, Long> backoffUntilByHost = new ConcurrentHashMap<>();
    private final Set<String> loading = ConcurrentHashMap.newKeySet();
    /** Feeds already looked for on disk (looked up once, on first use). */
    private final Set<String> diskChecked = ConcurrentHashMap.newKeySet();
    private final ExecutorService loader = Executors.newFixedThreadPool(2, daemonThreads());

    @Value("${lune.feeds.cache-dir:${user.home}/.lune/feeds}")
    private Path cacheDir;

    public FeedCache(@Qualifier("bulkRestTemplate") RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    @PreDestroy
    void shutdown() {
        loader.shutdownNow();
    }

    /** The feed as it is in memory now; queues a download if it's missing or older than its refresh interval. */
    @SuppressWarnings("unchecked")
    public <T> Result<T> get(Spec<T> spec) {
        if (diskChecked.add(spec.name())) {
            loadFromDisk(spec);
        }
        Entry entry = entries.get(spec.name());
        if (entry == null || System.currentTimeMillis() - entry.fetchedAt() > spec.refreshMs()) {
            queueLoad(spec);
        }
        return new Result<>(
                entry == null ? null : (T) entry.data(),
                entry == null ? null : Instant.ofEpochMilli(entry.fetchedAt()).toString(),
                loading.contains(spec.name()),
                errors.get(spec.name()));
    }

    private <T> void queueLoad(Spec<T> spec) {
        String host = URI.create(spec.url()).getHost();
        if (System.currentTimeMillis() < backoffUntilByHost.getOrDefault(host, 0L) || !loading.add(spec.name())) {
            return;
        }
        try {
            loader.submit(() -> {
                try {
                    load(spec, host);
                } finally {
                    loading.remove(spec.name());
                }
            });
        } catch (RuntimeException e) {
            loading.remove(spec.name()); // executor shut down during a restart
        }
    }

    private <T> void load(Spec<T> spec, String host) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set(HttpHeaders.USER_AGENT, USER_AGENT);
            headers.setAccept(List.of(MediaType.APPLICATION_JSON));
            String body = restTemplate.exchange(URI.create(spec.url()), HttpMethod.GET, new HttpEntity<>(headers), String.class).getBody();
            T data = spec.parser().apply(JsonMapper.shared().readTree(body));
            long now = System.currentTimeMillis();
            entries.put(spec.name(), new Entry(data, now));
            errors.remove(spec.name());
            writeToDisk(spec.name(), body);
            log.info("Feed {}: downloaded", spec.name());
        } catch (HttpStatusCodeException e) {
            fail(spec, host, "upstream returned " + e.getStatusCode().value());
        } catch (Exception e) {
            fail(spec, host, e.getMessage());
        }
    }

    private void fail(Spec<?> spec, String host, String reason) {
        backoffUntilByHost.put(host, System.currentTimeMillis() + FAILURE_BACKOFF_MS);
        errors.put(spec.name(), "Couldn't refresh from " + host + " (" + reason + ")");
        log.warn("Feed {} failed ({}); pausing {} for {} min", spec.name(), reason, host, FAILURE_BACKOFF_MS / 60_000);
    }

    // ── Disk cache: the upstream's own JSON, one file per feed; mtime is the download time ──

    private Path fileFor(String name) {
        return cacheDir.resolve(name + ".json");
    }

    private void writeToDisk(String name, String body) {
        try {
            Files.createDirectories(cacheDir);
            Path tmp = Files.createTempFile(cacheDir, "feed", ".tmp");
            Files.writeString(tmp, body, StandardCharsets.UTF_8);
            Files.move(tmp, fileFor(name), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            log.warn("Could not write feed cache {}: {}", name, e.getMessage());
        }
    }

    private <T> void loadFromDisk(Spec<T> spec) {
        Path file = fileFor(spec.name());
        if (!Files.isRegularFile(file)) {
            return;
        }
        try {
            T data = spec.parser().apply(JsonMapper.shared().readTree(Files.readString(file, StandardCharsets.UTF_8)));
            entries.putIfAbsent(spec.name(), new Entry(data, Files.getLastModifiedTime(file).toMillis()));
        } catch (Exception e) {
            log.warn("Could not read feed cache {}: {}", file, e.getMessage());
        }
    }

    private static java.util.concurrent.ThreadFactory daemonThreads() {
        AtomicInteger n = new AtomicInteger();
        return r -> {
            Thread t = new Thread(r, "feed-loader-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
    }
}
