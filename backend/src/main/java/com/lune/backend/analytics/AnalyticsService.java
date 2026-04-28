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

    public ClusterResponseDto cluster(ClusterRequestDto request) {
        try {
            ClusterResponseDto dto = webClient.post()
                    .uri("/cluster")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(ClusterResponseDto.class)
                    .block(Duration.ofSeconds(60));
            if (dto == null) {
                throw new IllegalStateException("Empty response from analytics service");
            }
            return dto;
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
