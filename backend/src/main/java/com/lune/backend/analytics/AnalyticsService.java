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

    private final WebClient webClient;

    public AnalyticsService(@Value("${lune.analytics.base-url:http://127.0.0.1:8000}") String baseUrl) {
        this.webClient = WebClient.builder()
                .baseUrl(baseUrl)
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
        return post("/cluster", request, ClusterResponseDto.class);
    }

    /**
     * Settings helpers (k sweeps, DBSCAN k-distance curve). Passed through as JSON: Spring adds nothing to
     * these, so it doesn't need its own copy of their shape.
     */
    public String sweep(String requestJson) {
        return post("/sweep", requestJson, String.class);
    }

    private <T> T post(String path, Object body, Class<T> responseType) {
        try {
            T result = webClient.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(responseType)
                    .block(Duration.ofSeconds(60));
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
