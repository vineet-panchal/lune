package com.lune.backend.satellite;

import com.lune.backend.satellite.dto.CelestrakSatelliteDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Bulk TLE downloads from CelesTrak (3LE text format).
 * Only {@link SatelliteCatalog} should call this: CelesTrak firewalls clients that download the same
 * data more often than it updates (~every 2 hours), so every call here must be cached by the caller.
 */
@Component
@Slf4j
public class CelestrakApiClient {

    private static final String BASE_URL = "https://celestrak.org/NORAD/elements/gp.php";
    // After any CelesTrak failure, stop calling it for a while instead of retrying on every request.
    private static final long FAILURE_BACKOFF_MS = 10 * 60_000;
    private static final String USER_AGENT = "lune-backend/1.0 (satellite-tracker)";

    private final RestTemplate restTemplate;
    private volatile long backoffUntil = 0;

    public CelestrakApiClient(@Qualifier("bulkRestTemplate") RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /** All satellites in a CelesTrak group (e.g. "STARLINK", "GPS-OPS"). Empty on failure. */
    public List<CelestrakSatelliteDto> fetchGroup(String group) {
        return fetch("GROUP", group.toUpperCase());
    }

    /** All satellites whose name contains the given text (e.g. "KUIPER"). Empty on failure. */
    public List<CelestrakSatelliteDto> fetchByName(String name) {
        return fetch("NAME", name);
    }

    /** One satellite by NORAD catalog number. */
    public Optional<CelestrakSatelliteDto> fetchSatellite(int noradId) {
        return fetch("CATNR", String.valueOf(noradId)).stream().findFirst();
    }

    public boolean isBackingOff() {
        return System.currentTimeMillis() < backoffUntil;
    }

    private List<CelestrakSatelliteDto> fetch(String param, String value) {
        if (isBackingOff()) {
            return List.of();
        }
        URI uri = UriComponentsBuilder.fromUriString(BASE_URL)
                .queryParam(param, value)
                .queryParam("FORMAT", "3le")
                .build()
                .toUri();
        try {
            String body = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<>(buildHeaders()), String.class).getBody();
            return parse3le(body);
        } catch (Exception e) {
            if (!isBackingOff()) {
                log.warn("CelesTrak request failed ({}); pausing CelesTrak calls for {} min", e.getMessage(), FAILURE_BACKOFF_MS / 60_000);
            }
            backoffUntil = System.currentTimeMillis() + FAILURE_BACKOFF_MS;
            return List.of();
        }
    }

    /** Parse 3LE text (name line, line 1, line 2 per satellite). Lines starting with '#' are ignored. */
    static List<CelestrakSatelliteDto> parse3le(String body) {
        if (body == null || body.isBlank() || body.stripLeading().startsWith("<")) {
            return List.of();
        }
        String[] lines = body.strip().lines()
                .map(String::trim)
                .filter(l -> !l.isEmpty() && !l.startsWith("#"))
                .toArray(String[]::new);

        List<CelestrakSatelliteDto> result = new ArrayList<>();
        for (int i = 0; i + 2 < lines.length; ) {
            String nameLine = lines[i];
            String l1 = lines[i + 1];
            String l2 = lines[i + 2];
            if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) {
                i++; // resync on malformed input
                continue;
            }
            i += 3;
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

    static String format3le(List<CelestrakSatelliteDto> satellites) {
        StringBuilder sb = new StringBuilder(satellites.size() * 170);
        for (CelestrakSatelliteDto s : satellites) {
            sb.append(s.getName() != null ? s.getName() : s.getNoradCatId()).append('\n')
                    .append(s.getLine1()).append('\n')
                    .append(s.getLine2()).append('\n');
        }
        return sb.toString();
    }

    private HttpHeaders buildHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.USER_AGENT, USER_AGENT);
        headers.setAccept(List.of(MediaType.TEXT_PLAIN, MediaType.ALL));
        return headers;
    }
}
