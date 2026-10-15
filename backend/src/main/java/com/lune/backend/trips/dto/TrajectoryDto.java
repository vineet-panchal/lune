package com.lune.backend.trips.dto;

/**
 * A spacecraft's path around the Sun, from JPL Horizons: heliocentric, ecliptic and equinox of J2000.
 * Points are dense around flybys and sparse where the path is smooth, so interpolate with the velocities
 * (cubic Hermite) rather than straight lines.
 *
 * @param t  time of each point (epoch ms, UTC)
 * @param p  positions in AU, x,y,z per point
 * @param v  velocities in AU/day, x,y,z per point
 */
public record TrajectoryDto(double[] t, double[] p, double[] v) {
}
