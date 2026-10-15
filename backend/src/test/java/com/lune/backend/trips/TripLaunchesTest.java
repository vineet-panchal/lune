package com.lune.backend.trips;

import com.lune.backend.mission.dto.LaunchDto;
import com.lune.backend.trips.dto.TripLaunchDto;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class TripLaunchesTest {

    private static LaunchDto launch(String missionName, String description, String orbit) {
        return new LaunchDto("id", "Rocket | " + missionName, missionName, "Go", "Go for Launch", "2026-10-19T19:41:03Z", "SEC",
                null, null, "Provider", "H3-24", "Planetary Science", description, orbit, "Pad", "Place", "JP",
                30.4, 130.97, null, null, null, false, null, null, null);
    }

    @Test
    void marsOrbitWithAMoonInTheDescriptionGoesToThatMoon() {
        TripLaunchDto t = TripLaunches.classify(launch("Martian Moons eXploration (MMX)",
                "MMX is a Japanese scientific mission to land on Phobos, one of the two moons of Mars, to collect samples.", "Mars Orbit"));
        assertEquals("Phobos", t.destination());
        assertEquals("Mars", t.planet());
    }

    @Test
    void planetOrbitAloneGoesToThePlanet() {
        TripLaunchDto t = TripLaunches.classify(launch("Venus orbiter", "Studies the atmosphere.", "Venus Orbit"));
        assertEquals("Venus", t.destination());
    }

    @Test
    void lunarOrbitsGoToTheMoon() {
        assertEquals("Moon", TripLaunches.classify(launch("IM-3", "A lander for Reiner Gamma.", "Lunar Orbit")).destination());
        assertEquals("Earth", TripLaunches.classify(launch("IM-3", "", "Lunar Surface")).planet());
    }

    @Test
    void heliocentricMissionsUseTheFirstBodyMentioned() {
        TripLaunchDto t = TripLaunches.classify(launch("Clipper II", "Will orbit Jupiter and fly past Europa dozens of times.", "Heliocentric N/A"));
        assertEquals("Europa", t.destination());
        assertEquals("Jupiter", t.planet());
        assertEquals("Saturn", TripLaunches.classify(launch("Ring explorer", "Heads for Saturn.", "Heliocentric N/A")).destination());
    }

    @Test
    void earthOrbitsAndUnnamedDeepSpaceAreSkipped() {
        assertNull(TripLaunches.classify(launch("Starlink", "Mars is the long-term goal.", "Low Earth Orbit")));
        assertNull(TripLaunches.classify(launch("Solar observatory", "Watches the Sun.", "Heliocentric N/A")));
        assertNull(TripLaunches.classify(launch("Weather sat", "Titanium tanks.", "Sun-Synchronous Orbit")));
    }
}
