package com.lune.backend.mission.dto;

import java.util.List;

/**
 * One article from the Spaceflight News API.
 *
 * @param launchIds Launch Library ids of launches the article is about (match them against the launch feeds)
 */
public record NewsArticleDto(
        long id,
        String title,
        String summary,
        String url,
        String imageUrl,
        String site,
        String publishedAt,
        List<String> launchIds
) {
}
