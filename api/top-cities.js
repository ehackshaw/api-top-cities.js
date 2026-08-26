/**
 * =========================================================
 * BOKKARA — TOP 50 CITIES API
 * =========================================================
 *
 * GET /api/top-cities
 *
 * GET /api/top-cities?limit=50
 *
 * PHOTO:
 *
 * GET /api/top-cities?photo=PHOTO_RESOURCE_NAME
 *
 * =========================================================
 *
 * RETURNS CITIES ONLY
 *
 * No:
 * - Parks
 * - Museums
 * - Restaurants
 * - Hotels
 * - Attractions
 * - Landmarks
 * - Beaches
 * - Airports
 *
 * =========================================================
 */


const GOOGLE_PLACES_URL =
  "https://places.googleapis.com/v1/places:searchText";


// =========================================================
// SETTINGS
// =========================================================

const DEFAULT_LIMIT = 50;

const MAX_RESULTS_PER_QUERY = 20;

const MIN_RATING = 4.0;

const MIN_REVIEWS = 25;

const CACHE_DURATION =
  1000 * 60 * 60 * 6;


// =========================================================
// CITY TYPES
// =========================================================

const CITY_TYPES = [

  "locality",

  "postal_town",

  "administrative_area_level_2"

];


// =========================================================
// BLOCKED TYPES
// =========================================================

const BLOCKED_TYPES = [

  "park",

  "museum",

  "restaurant",

  "cafe",

  "bar",

  "hotel",

  "tourist_attraction",

  "point_of_interest",

  "landmark",

  "shopping_mall",

  "shopping_center",

  "airport",

  "beach",

  "campground",

  "stadium",

  "amusement_park",

  "aquarium",

  "zoo",

  "art_gallery",

  "church",

  "mosque",

  "hindu_temple",

  "synagogue",

  "night_club",

  "casino",

  "spa",

  "store",

  "school",

  "university",

  "hospital",

  "movie_theater",

  "gym",

  "library",

  "cemetery",

  "natural_feature"

];


// =========================================================
// CITY SEARCHES
// =========================================================
//
// These searches are intentionally city-focused.
//
// They are NOT individual hardcoded cities.
//
// =========================================================

const SEARCH_QUERIES = [

  "world famous cities",

  "best cities in North America",

  "best cities in South America",

  "best cities in Central America",

  "best cities in the Caribbean",

  "best cities in Europe",

  "best cities in Asia",

  "best cities in Africa",

  "best cities in Oceania",

  "best cities in Australia",

  "best cities in New Zealand",

  "best cities in United States",

  "best cities in Canada",

  "best cities in Mexico",

  "best cities in Brazil",

  "best cities in Argentina",

  "best cities in Colombia",

  "best cities in Peru",

  "best cities in Chile",

  "best cities in United Kingdom",

  "best cities in France",

  "best cities in Italy",

  "best cities in Spain",

  "best cities in Germany",

  "best cities in Portugal",

  "best cities in Greece",

  "best cities in Netherlands",

  "best cities in Switzerland",

  "best cities in Austria",

  "best cities in Turkey",

  "best cities in Japan",

  "best cities in South Korea",

  "best cities in Thailand",

  "best cities in Singapore",

  "best cities in Indonesia",

  "best cities in Malaysia",

  "best cities in Vietnam",

  "best cities in Philippines",

  "best cities in India",

  "best cities in United Arab Emirates",

  "best cities in South Africa",

  "best cities in Egypt",

  "best cities in Morocco"

];


// =========================================================
// FIELD MASK
// =========================================================

const FIELD_MASK = [

  "places.id",

  "places.displayName",

  "places.formattedAddress",

  "places.addressComponents",

  "places.rating",

  "places.userRatingCount",

  "places.photos",

  "places.googleMapsUri",

  "places.types"

].join(",");


// =========================================================
// CACHE
// =========================================================

let citiesCache = null;

let citiesCacheExpires = 0;


// =========================================================
// NORMALIZE
// =========================================================

function normalize(
  value
) {

  if (!value) {

    return "";

  }

  return String(value)

    .trim()

    .toLowerCase()

    .replace(/\s+/g, " ");

}


// =========================================================
// ADDRESS COMPONENT
// =========================================================

function getAddressComponent(
  place,
  wantedTypes
) {

  const components =
    place?.addressComponents || [];


  for (
    const component
    of components
  ) {

    const types =
      component.types || [];


    for (
      const wantedType
      of wantedTypes
    ) {

      if (
        types.includes(
          wantedType
        )
      ) {

        return (

          component.longText ||

          component.shortText ||

          ""

        );

      }

    }

  }


  return "";

}


// =========================================================
// CITY NAME
// =========================================================

function getCityName(
  place
) {

  /*
   * First choice:
   * locality
   */

  const locality =
    getAddressComponent(
      place,
      [
        "locality"
      ]
    );


  if (
    locality
  ) {

    return locality;

  }


  /*
   * Second choice:
   * postal town
   */

  const postalTown =
    getAddressComponent(
      place,
      [
        "postal_town"
      ]
    );


  if (
    postalTown
  ) {

    return postalTown;

  }


  /*
   * Third choice:
   * administrative level 2
   */

  const adminArea =
    getAddressComponent(
      place,
      [
        "administrative_area_level_2"
      ]
    );


  if (
    adminArea
  ) {

    return adminArea;

  }


  return "";

}


// =========================================================
// COUNTRY
// =========================================================

function getCountry(
  place
) {

  const country =
    getAddressComponent(
      place,
      [
        "country"
      ]
    );


  if (
    country
  ) {

    return country;

  }


  /*
   * Fallback to formatted address.
   */

  const address =
    place?.formattedAddress ||
    "";


  const parts =
    address
      .split(",")
      .map(
        part =>
          part.trim()
      )
      .filter(Boolean);


  if (
    parts.length >= 2
  ) {

    return parts[
      parts.length - 1
    ];

  }


  return "";

}


// =========================================================
// IS CITY
// =========================================================

function isCity(
  place
) {

  if (!place) {

    return false;

  }


  const types =
    Array.isArray(
      place.types
    )
      ? place.types
      : [];


  /*
   * If Google explicitly identifies the result
   * as an attraction/business/etc., reject it.
   */

  const blocked =
    types.some(
      type =>
        BLOCKED_TYPES.includes(
          type
        )
    );


  if (
    blocked
  ) {

    return false;

  }


  /*
   * City must have one of the accepted
   * geographic city types.
   */

  const cityType =
    types.some(
      type =>
        CITY_TYPES.includes(
          type
        )
    );


  if (
    !cityType
  ) {

    return false;

  }


  /*
   * It must have a real city name.
   */

  const city =
    getCityName(
      place
    );


  if (
    !city
  ) {

    return false;

  }


  /*
   * It must have a country.
   */

  const country =
    getCountry(
      place
    );


  if (
    !country
  ) {

    return false;

  }


  return true;

}


// =========================================================
// SCORE
// =========================================================

function calculateScore(
  rating,
  reviews
) {

  const safeRating =
    Number(rating) || 0;


  const safeReviews =
    Number(reviews) || 0;


  const ratingScore =
    Math.max(
      0,
      Math.min(
        100,
        (
          (safeRating - 4) /
          1
        ) * 100
      )
    );


  const reviewScore =
    Math.min(
      100,
      (
        Math.log10(
          Math.max(
            1,
            safeReviews
          )
        ) / 6
      ) * 100
    );


  return (

    ratingScore * 0.70 +

    reviewScore * 0.30

  );

}


// =========================================================
// SEARCH GOOGLE
// =========================================================

async function searchGoogle(
  query,
  apiKey
) {

  const response =
    await fetch(
      GOOGLE_PLACES_URL,
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "X-Goog-Api-Key":
            apiKey,

          "X-Goog-FieldMask":
            FIELD_MASK

        },

        body:
          JSON.stringify({

            textQuery:
              query,

            maxResultCount:
              MAX_RESULTS_PER_QUERY,

            rankPreference:
              "RELEVANCE"

          })

      }
    );


  if (
    !response.ok
  ) {

    const error =
      await response.text();


    throw new Error(
      `Google Places ${response.status}: ${error}`
    );

  }


  return response.json();

}


// =========================================================
// BUILD CITIES
// =========================================================

async function buildTopCities(
  apiKey
) {

  const cityMap =
    new Map();


  /*
   * Run searches in parallel.
   */

  const responses =
    await Promise.allSettled(

      SEARCH_QUERIES.map(
        query =>
          searchGoogle(
            query,
            apiKey
          )
      )

    );


  /*
   * Process every successful response.
   */

  for (
    const result
    of responses
  ) {

    if (
      result.status !==
      "fulfilled"
    ) {

      continue;

    }


    const places =
      result
        .value
        ?.places ||
      [];


    for (
      const place
      of places
    ) {

      /*
       * ===================================================
       * CITY FILTER
       * ===================================================
       */

      if (
        !isCity(
          place
        )
      ) {

        continue;

      }


      const city =
        getCityName(
          place
        );


      const country =
        getCountry(
          place
        );


      if (
        !city ||
        !country
      ) {

        continue;

      }


      const rating =
        Number(
          place.rating
        ) || 0;


      const reviews =
        Number(
          place.userRatingCount
        ) || 0;


      /*
       * Require a good rating.
       */

      if (
        rating <
        MIN_RATING
      ) {

        continue;

      }


      /*
       * Require some reviews.
       */

      if (
        reviews <
        MIN_REVIEWS
      ) {

        continue;

      }


      /*
       * Require a photo.
       *
       * This guarantees the frontend can display
       * an image.
       */

      const photo =
        place.photos?.[0]
          ?.name ||
        null;


      if (
        !photo
      ) {

        continue;

      }


      const key =
        `${normalize(city)}|${normalize(country)}`;


      const score =
        calculateScore(
          rating,
          reviews
        );


      /*
       * =================================================
       * NEW CITY
       * =================================================
       */

      if (
        !cityMap.has(
          key
        )
      ) {

        cityMap.set(

          key,

          {

            city,

            country,

            rating,

            reviewCount:
              reviews,

            score,

            appearances:
              1,

            placeId:
              place.id ||
              null,

            googleMapsUrl:
              place.googleMapsUri ||
              null,

            photoName:
              photo,

            photoAttributions:
              place.photos?.[0]
                ?.authorAttributions ||
              [],

            googleTypes:
              place.types ||
              []

          }

        );


        continue;

      }


      /*
       * =================================================
       * EXISTING CITY
       * =================================================
       */

      const existing =
        cityMap.get(
          key
        );


      existing.appearances +=
        1;


      /*
       * Multiple searches finding the same city
       * increases its score.
       */

      existing.score +=
        score * 0.10;


      /*
       * Keep the better-rated Google result.
       */

      if (
        rating >
        existing.rating
      ) {

        existing.rating =
          rating;

        existing.reviewCount =
          reviews;

        existing.placeId =
          place.id ||
          existing.placeId;

        existing.googleMapsUrl =
          place.googleMapsUri ||
          existing.googleMapsUrl;

        existing.photoName =
          photo;

        existing.photoAttributions =
          place.photos?.[0]
            ?.authorAttributions ||
          existing.photoAttributions;

        existing.googleTypes =
          place.types ||
          existing.googleTypes;

      }

    }

  }


  /*
   * =======================================================
   * SORT
   * =======================================================
   */

  const cities =
    Array.from(
      cityMap.values()
    );


  cities.sort(
    (
      a,
      b
    ) => {

      if (
        b.score !==
        a.score
      ) {

        return (
          b.score -
          a.score
        );

      }


      if (
        b.rating !==
        a.rating
      ) {

        return (
          b.rating -
          a.rating
        );

      }


      return (
        b.reviewCount -
        a.reviewCount
      );

    }
  );


  /*
   * =======================================================
   * RETURN 50
   * =======================================================
   */

  return cities

    .slice(
      0,
      DEFAULT_LIMIT
    )

    .map(
      (
        city,
        index
      ) => ({

        rank:
          index + 1,

        city:
          city.city,

        country:
          city.country,

        rating:
          Number(
            city.rating.toFixed(1)
          ),

        reviewCount:
          city.reviewCount,

        appearances:
          city.appearances,

        score:
          Number(
            city.score.toFixed(2)
          ),

        placeId:
          city.placeId,

        googleMapsUrl:
          city.googleMapsUrl,

        photoName:
          city.photoName,

        photoAttributions:
          city.photoAttributions,

        googleTypes:
          city.googleTypes

      })

    );

}


// =========================================================
// GOOGLE PHOTO
// =========================================================

async function getGooglePhoto(
  photoName,
  apiKey
) {

  if (
    !photoName ||
    !photoName.startsWith(
      "places/"
    ) ||
    !photoName.includes(
      "/photos/"
    )
  ) {

    throw new Error(
      "Invalid Google photo resource."
    );

  }


  const photoUrl =
    `https://places.googleapis.com/v1/${photoName}/media` +
    `?maxWidthPx=1000` +
    `&maxHeightPx=1000` +
    `&key=${encodeURIComponent(
      apiKey
    )}`;


  const response =
    await fetch(
      photoUrl,
      {
        redirect:
          "follow"
      }
    );


  if (
    !response.ok
  ) {

    const error =
      await response.text();


    throw new Error(
      `Google photo ${response.status}: ${error}`
    );

  }


  const contentType =
    response.headers.get(
      "content-type"
    ) ||
    "image/jpeg";


  const image =
    Buffer.from(
      await response.arrayBuffer()
    );


  return {

    image,

    contentType

  };

}


// =========================================================
// HANDLER
// =========================================================

export default async function handler(
  req,
  res
) {


  // =======================================================
  // CORS
  // =======================================================

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  // =======================================================
  // OPTIONS
  // =======================================================

  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  // =======================================================
  // METHOD
  // =======================================================

  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        success:
          false,

        error:
          "Method not allowed."

      });

  }


  // =======================================================
  // API KEY
  // =======================================================

  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY;


  if (!apiKey) {

    return res
      .status(500)
      .json({

        success:
          false,

        error:
          "GOOGLE_PLACES_API_KEY is missing."

      });

  }


  // =======================================================
  // PHOTO
  // =======================================================

  const photo =
    req.query?.photo;


  if (
    photo
  ) {

    try {

      const result =
        await getGooglePhoto(
          photo,
          apiKey
        );


      res.setHeader(
        "Content-Type",
        result.contentType
      );


      res.setHeader(
        "Cache-Control",
        "public, max-age=86400"
      );


      return res
        .status(200)
        .send(
          result.image
        );


    } catch (
      error
    ) {

      console.error(
        "Photo error:",
        error
      );


      return res
        .status(500)
        .json({

          success:
            false,

          error:
            "Unable to retrieve photo."

        });

    }

  }


  // =======================================================
  // LIMIT
  // =======================================================

  let limit =
    Number(
      req.query?.limit
    );


  if (
    !Number.isFinite(
      limit
    )
  ) {

    limit =
      DEFAULT_LIMIT;

  }


  limit =
    Math.floor(
      limit
    );


  limit =
    Math.max(
      1,
      Math.min(
        DEFAULT_LIMIT,
        limit
      )
    );


  // =======================================================
  // CACHE
  // =======================================================

  const now =
    Date.now();


  if (
    citiesCache &&
    citiesCacheExpires > now &&
    citiesCache.length >= limit
  ) {

    return res
      .status(200)
      .json({

        success:
          true,

        cached:
          true,

        count:
          limit,

        cities:
          citiesCache.slice(
            0,
            limit
          )

      });

  }


  // =======================================================
  // BUILD
  // =======================================================

  try {

    const cities =
      await buildTopCities(
        apiKey
      );


    /*
     * Do NOT throw just because fewer than 50
     * cities were found.
     *
     * If Google gives us 20 good cities,
     * return those 20.
     */

    if (
      !cities.length
    ) {

      throw new Error(
        "Google Places returned no qualifying cities."
      );

    }


    // =====================================================
    // CACHE
    // =====================================================

    citiesCache =
      cities;


    citiesCacheExpires =
      now +
      CACHE_DURATION;


    // =====================================================
    // RESPONSE
    // =====================================================

    return res
      .status(200)
      .json({

        success:
          true,

        cached:
          false,

        generatedAt:
          new Date().toISOString(),

        count:
          Math.min(
            limit,
            cities.length
          ),

        cities:
          cities.slice(
            0,
            limit
          )

      });


  } catch (
    error
  ) {

    console.error(
      "Top cities error:",
      error
    );


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          "Unable to retrieve top cities.",

        message:
          error.message

      });

  }

}
