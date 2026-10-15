package com.lune.backend.analytics;

import com.lune.backend.analytics.dto.ClusterRequestDto;
import com.lune.backend.analytics.dto.ClusterResponseDto;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;

@Service
public class AnalyticsService {

    /** Model calls on ~12k satellites take seconds; close-approach screening over 12 h takes ~40 s. */
    private static final Duration MODEL_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration CONJUNCTION_TIMEOUT = Duration.ofSeconds(150);
    /** Per-satellite responses (labels, PCA coordinates) for 12k satellites exceed WebClient's 256 KB default. */
    private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

    private final WebClient webClient;

    public AnalyticsService(@Value("${lune.analytics.base-url:http://127.0.0.1:8000}") String baseUrl) {
        this.webClient = WebClient.builder()
                .baseUrl(baseUrl)
                .codecs(c -> c.defaultCodecs().maxInMemorySize(MAX_RESPONSE_BYTES))
                .build();
    }

    /** Whether the Python service answers its /health endpoint. Short timeout: the UI polls this. */
    public boolean isHealthy() {
        try {
            webClient.get()
                    .uri("/health")
                    .retrieve()
                    .toBodilessEntity()
                    .block(Duration.ofSeconds(2));
            return true;
        }
        catch (RuntimeException e) {
            return false;
        }
    }

    public ClusterResponseDto cluster(ClusterRequestDto request) {
        return post("/cluster", request, ClusterResponseDto.class, MODEL_TIMEOUT);
    }

    /**
     * Settings helpers (k sweeps, DBSCAN k-distance curve). Passed through as JSON: Spring adds nothing to
     * these, so it doesn't need its own copy of their shape.
     */
    public String sweep(String requestJson) {
        return post("/sweep", requestJson, String.class, MODEL_TIMEOUT);
    }

    /** The model's view in 2D (PCA of the standardised features); passed through as JSON. */
    public String project(String requestJson) {
        return post("/project", requestJson, String.class, MODEL_TIMEOUT);
    }

    /** Close approaches between satellites over the next hours; passed through as JSON. */
    public String conjunctions(String requestJson) {
        return post("/conjunctions", requestJson, String.class, CONJUNCTION_TIMEOUT);
    }

    private <T> T post(String path, Object body, Class<T> responseType, Duration timeout) {
        try {
            T result = webClient.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(responseType)
                    .block(timeout);
            if (result == null) {
                throw new IllegalStateException("Empty response from analytics service");
            }
            return result;
        }
        catch (WebClientResponseException e) {
            throw new IllegalStateException(
                    "Analytics service returned " + e.getStatusCode().value() + ": " + e.getResponseBodyAsString(),
                    e);
        }
        catch (WebClientRequestException e) {
            throw new IllegalStateException(
                    "Cannot reach analytics service. Is the Python API running at the configured base URL?",
                    e);
        }
    }
}
