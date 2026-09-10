/**
 * Share the insertion pipeline's boolean validator rather than maintaining
 * divergent scraper rules. Requires a canonical Place ID (placeId or id),
 * accepts mapsUrl/googleMapsUrl, and strictly validates optional numeric/URL
 * fields. Validation does not insert, update, or remove any stored records.
 */
export { validateRestaurant } from "../pipeline/validator";