package com.lune.backend.trips.dto;

/**
 * A moon's orbit around its planet from JPL Horizons, as osculating elements every couple of days: planet-centred,
 * ICRF (J2000 equatorial) axes. Between samples, propagate the nearest one as a Kepler orbit.
 *
 * @param t     time of each sample (epoch ms, UTC)
 * @param a     semi-major axis, km
 * @param e     eccentricity
 * @param i     inclination to the J2000 equator, degrees
 * @param node  longitude of the ascending node, degrees
 * @param peri  argument of periapsis, degrees
 * @param ma    mean anomaly, degrees
 * @param n     mean motion, degrees per second
 */
public record MoonElementsDto(double[] t, double[] a, double[] e, double[] i, double[] node, double[] peri, double[] ma, double[] n) {
}
