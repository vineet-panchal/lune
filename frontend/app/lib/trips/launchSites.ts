/**
 * Launch pads. The azimuth range is the set of directions a rocket may fly from the pad without passing over
 * populated land early in flight (range safety); it, and the latitude, decide which orbits are reachable.
 * Azimuths are degrees clockwise from north; a range may wrap past 360°.
 */
export type LaunchSite = {
  id: string;
  name: string;
  short: string;
  country: string;
  latDeg: number;
  lngDeg: number;
  azMinDeg: number;
  azMaxDeg: number;
};

export const LAUNCH_SITES: LaunchSite[] = [
  { id: "ksc-lc-39a", name: "Kennedy Space Center LC-39A", short: "LC-39A", country: "US", latDeg: 28.6082, lngDeg: -80.6041, azMinDeg: 35, azMaxDeg: 120 },
  { id: "ksc-lc-39b", name: "Kennedy Space Center LC-39B", short: "LC-39B", country: "US", latDeg: 28.6272, lngDeg: -80.6209, azMinDeg: 35, azMaxDeg: 120 },
  { id: "ccsfs-slc-40", name: "Cape Canaveral SLC-40", short: "SLC-40", country: "US", latDeg: 28.5619, lngDeg: -80.5772, azMinDeg: 35, azMaxDeg: 120 },
  { id: "ccsfs-slc-41", name: "Cape Canaveral SLC-41", short: "SLC-41", country: "US", latDeg: 28.5833, lngDeg: -80.583, azMinDeg: 35, azMaxDeg: 120 },
  { id: "vsfb-slc-4e", name: "Vandenberg SLC-4E", short: "SLC-4E", country: "US", latDeg: 34.6321, lngDeg: -120.6107, azMinDeg: 147, azMaxDeg: 235 },
  { id: "vsfb-slc-3e", name: "Vandenberg SLC-3E", short: "SLC-3E", country: "US", latDeg: 34.6401, lngDeg: -120.5895, azMinDeg: 147, azMaxDeg: 235 },
  { id: "csg-ela-4", name: "Guiana Space Centre ELA-4, Kourou", short: "ELA-4", country: "FR", latDeg: 5.239, lngDeg: -52.7686, azMinDeg: 350, azMaxDeg: 453 },
  { id: "wenchang-lc-101", name: "Wenchang LC-101", short: "Wenchang", country: "CN", latDeg: 19.6145, lngDeg: 110.951, azMinDeg: 85, azMaxDeg: 160 },
  { id: "baikonur-81-24", name: "Baikonur Site 81/24", short: "Baikonur", country: "KZ", latDeg: 46.0712, lngDeg: 62.9848, azMinDeg: 35, azMaxDeg: 65 },
  { id: "tanegashima-yla", name: "Tanegashima Yoshinobu", short: "Tanegashima", country: "JP", latDeg: 30.4009, lngDeg: 130.975, azMinDeg: 90, azMaxDeg: 150 },
  { id: "sriharikota-slp", name: "Satish Dhawan Second Launch Pad", short: "Sriharikota", country: "IN", latDeg: 13.7199, lngDeg: 80.2304, azMinDeg: 102, azMaxDeg: 140 },
];

export const SITE_BY_ID = new Map(LAUNCH_SITES.map((s) => [s.id, s]));

/** Whether an azimuth (0–360°) lies in the site's allowed range. */
export function azimuthAllowed(site: LaunchSite, azDeg: number): boolean {
  const az = ((azDeg % 360) + 360) % 360;
  return (az >= site.azMinDeg && az <= site.azMaxDeg) || (az + 360 >= site.azMinDeg && az + 360 <= site.azMaxDeg);
}
