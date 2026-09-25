// Reference extents only. Do not send these whole-country boxes to public Overpass.
export const countryBoundingBoxes = {
  uk: { minLat: 49.9, minLon: -8.6, maxLat: 60.9, maxLon: 1.8 },
  usa: { minLat: 24.5, minLon: -125.0, maxLat: 49.5, maxLon: -66.9 },
  france: { minLat: 41.3, minLon: -5.1, maxLat: 51.1, maxLon: 9.6 },
  germany: { minLat: 47.2, minLon: 5.9, maxLat: 55.1, maxLon: 15.0 },
  italy: { minLat: 36.6, minLon: 6.6, maxLat: 47.1, maxLon: 18.5 },
  japan: { minLat: 30.9, minLon: 129.4, maxLat: 45.5, maxLon: 145.8 },
  australia: { minLat: -43.6, minLon: 112.9, maxLat: -10.0, maxLon: 153.6 },
};