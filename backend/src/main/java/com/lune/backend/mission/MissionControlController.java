package com.lune.backend.mission;

import com.lune.backend.mission.dto.CatalogPulseDto;
import com.lune.backend.mission.dto.ExpeditionDto;
import com.lune.backend.mission.dto.FlybyDto;
import com.lune.backend.mission.dto.LaunchDto;
import com.lune.backend.mission.dto.NewsArticleDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Mission Control: space news, launches, people in space, space weather, asteroid flybys and what Lune's own
 * catalog shows. Every endpoint answers from memory at once; loading=true means a download is still running.
 */
@RestController
@RequestMapping(value = "/api/mission", produces = MediaType.APPLICATION_JSON_VALUE)
@RequiredArgsConstructor
@CrossOrigin(origins = {"http://localhost:3000", "http://127.0.0.1:3000"}, allowCredentials = "true")
public class MissionControlController {

    private final MissionFeeds feeds;
    private final CatalogPulseService catalogPulse;

    @GetMapping("/news")
    public FeedCache.Result<List<NewsArticleDto>> news() {
        return feeds.news();
    }

    @GetMapping("/launches/upcoming")
    public FeedCache.Result<List<LaunchDto>> upcomingLaunches() {
        return feeds.upcomingLaunches();
    }

    @GetMapping("/launches/recent")
    public FeedCache.Result<List<LaunchDto>> recentLaunches() {
        return feeds.recentLaunches();
    }

    @GetMapping("/crew")
    public FeedCache.Result<List<ExpeditionDto>> crew() {
        return feeds.crew();
    }

    @GetMapping("/space-weather")
    public MissionFeeds.SpaceWeather spaceWeather() {
        return feeds.spaceWeather();
    }

    @GetMapping("/flybys")
    public FeedCache.Result<List<FlybyDto>> flybys() {
        return feeds.flybys();
    }

    @GetMapping("/catalog")
    public CatalogPulseDto catalog() {
        return catalogPulse.pulse();
    }
}
