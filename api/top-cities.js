/**
 * =========================================================
 * BOKKARA — TOP 50 CITIES API
 * =========================================================
 *
 * Endpoint:
 *
 * GET /api/top-cities
 *
 * Optional:
 *
 * GET /api/top-cities?limit=50
 *
 * Photo:
 *
 * GET /api/top-cities?photo=PHOTO_RESOURCE_NAME
 *
 * =========================================================
 *
 * IMPORTANT:
 *
 * This API returns CITIES ONLY.
 *
 * It does NOT return:
 *
 * - Parks
 * - Museums
 * - Restaurants
 * - Hotels
 * - Attractions
 * - Landmarks
 * - Beaches
 * - Shopping centers
 * - Airports
 * - Individual tourist attractions
 *
 * Google Places results are filtered using Google's
 * place types before they are added to the city list.
 *
 * =========================================================
 */


const GOOGLE_PLACES_URL =
  "https://places.googleapis.com/v1/places:searchText";


// =========================================================
// SETTINGS
// =========================================================

const DEFAULT_LIMIT = 50;

const MAX_GOOGLE_RESULTS_PER_SEARCH = 20;

const MIN_RATING = 4.0;

const MIN_REVIEWS = 25;

const CACHE_DURATION =
  1000 * 60 * 60 * 6;


// =========================================================
// CITY TYPES
// =========================================================
//
// These are the ONLY types that can become a city.
//
// "locality" is the primary city type.
//
// "postal_town" is used in some countries such as the UK.
//
// "administrative_area_level_1" is included as a fallback
// for places Google represents as a major destination city
// using an administrative locality.
//
// =========================================================

const ALLOWED_CITY_TYPES = [

  "locality",

  "postal_town",

  "administrative_area_level_1"

];


// =========================================================
// TYPES THAT MUST NEVER BE ACCEPTED
// =========================================================
//
// Extra protection in case Google returns a mixed set of
// types.
//
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

  "natural_feature",

  "establishment"

];


// =========================================================
// CITY DISCOVERY QUERIES
// =========================================================
//
// These are NOT individual hardcoded cities.
//
// They simply tell Google Places to discover cities.
//
// =========================================================

const SEARCH_QUERIES = [

  "best cities to visit in North America",

  "best cities to visit in South America",

  "best cities to visit in Central America",

  "best cities to visit in the Caribbean",

  "best cities to visit in Europe",

  "best cities to visit in Western Europe",

  "best cities to visit in Eastern Europe",

  "best cities to visit in Northern Europe",

  "best cities to visit in Southern Europe",

  "best cities to visit in Asia",

  "best cities to visit in Southeast Asia",

  "best cities to visit in East Asia",

  "best cities to visit in South Asia",

  "best cities to visit in the Middle East",

  "best cities to visit in Africa",

  "best cities to visit in Southern Africa",

  "best cities to visit in North Africa",

  "best cities to visit in Oceania",

  "best cities to visit in Australia",

  "best cities to visit in New Zealand",

  "top cities in United States for tourism",

  "top cities in Canada for tourism",

  "top cities in Mexico for tourism",

  "top cities in Brazil for tourism",

  "top cities in Argentina for tourism",

  "top cities in Colombia for tourism",

  "top cities in Peru for tourism",

  "top cities in Chile for tourism",

  "top cities in United Kingdom for tourism",

  "top cities in France for tourism",

  "top cities in Italy for tourism",

  "top cities in Spain for tourism",

  "top cities in Germany for tourism",

  "top cities in Portugal for tourism",

  "top cities in Greece for tourism",

  "top cities in Netherlands for tourism",

  "top cities in Switzerland for tourism",

  "top cities in Austria for tourism",

  "top cities in Turkey for tourism",

  "top cities in Japan for tourism",

  "top cities in South Korea for tourism",

  "top cities in Thailand for tourism",

  "top cities in Singapore for tourism",

  "top cities in Indonesia for tourism",

  "top cities in Malaysia for tourism",

  "top cities in Vietnam for tourism",

  "top cities in Philippines for tourism",

  "top cities in India for tourism",

  "top cities in United Arab Emirates for tourism",

  "top cities in South Africa for tourism",

  "top cities in Egypt for tourism",

  "top cities in Morocco for tourism"

];


// =========================================================
// GOOGLE FIELD MASK
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
// MEMORY CACHE
// =========================================================

let citiesCache = null;

let citiesCacheExpires = 0;


// =========================================================
// NORMALIZE TEXT
// =========================================================

function normalize(value) {

  if (!value) {

    return "";

  }

  return String(value)

    .trim()

    .toLowerCase()

    .replace(/\s+/g, " ");

}


// =========================================================
// GET ADDRESS COMPONENT
// =========================================================

function getAddressComponent(
  place,
  types
) {

  const components =
    place?.addressComponents || [];


  for (
    const component of components
  ) {

    const componentTypes =
      component.types || [];


    const matched =
      types.some(
        type =>
          componentTypes.includes(type)
      );


    if (matched) {

      return (

        component.longText ||

        component.shortText ||

        ""

      );

    }

  }


  return "";

}


// =========================================================
// EXTRACT CITY
// =========================================================
//
// Google addressComponents are preferred over trying to
// split formattedAddress manually.
//
// =========================================================

function extractCity(place) {

  const city =
    getAddressComponent(
      place,
      [
        "locality",
        "postal_town"
      ]
    );


  if (city) {

    return city;

  }


  /*
   * Some Google results may represent a major city
   * through an administrative area.
   */

  const administrativeCity =
    getAddressComponent(
      place,
      [
        "administrative_area_level_2"
      ]
    );


  if (administrativeCity) {

    return administrativeCity;

  }


  /*
   * Final fallback.
   */

  const address =
    place?.formattedAddress || "";


  const parts =
    address
      .split(",")
      .map(
        part =>
          part.trim()
      )
      .filter(Boolean);


  if (
    parts.length >= 3
  ) {

    return parts[
      parts.length - 2
    ];

  }


  if (
    parts.length === 2
  ) {

    return parts[0];

  }


  return "";

}


// =========================================================
// EXTRACT COUNTRY
// =========================================================

function extractCountry(place) {

  const country =
    getAddressComponent(
      place,
      [
        "country"
      ]
    );


  if (country) {

    return country;

  }


  const address =
    place?.formattedAddress || "";


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
//
// This is the most important part of the new backend.
//
// A Google result MUST:
// 1. Have a valid city type.
// 2. NOT contain a blocked place type.
// 3. Have a city name.
// 4. Have a country.
//
// =========================================================

function isCity(place) {

  if (!place) {

    return false;

  }


  const types =
    Array.isArray(
      place.types
    )
      ? place.types
      : [];


  const hasAllowedCityType =
    types.some(
      type =>
        ALLOWED_CITY_TYPES.includes(
          type
        )
    );


  if (
    !hasAllowedCityType
  ) {

    return false;

  }


  const hasBlockedType =
    types.some(
      type =>
        BLOCKED_TYPES.includes(
          type
        )
    );


  if (
    hasBlockedType
  ) {

    return false;

  }


  const city =
    extractCity(
      place
    );


  const country =
    extractCountry(
      place
    );


  if (!city) {

    return false;

  }


  if (!country) {

    return false;

  }


  return true;

}


// =========================================================
// CALCULATE CITY SCORE
// =========================================================

function calculateCityScore(
  rating,
  reviewCount
) {

  const safeRating =
    Number(rating) || 0;


  const safeReviews =
    Number(reviewCount) || 0;


  /*
   * Rating:
   *
   * 4.0 = 0
   * 5.0 = 100
   */

  const ratingScore =
    Math.max(
      0,
      Math.min(
        100,
        (
          (safeRating - 4.0) /
          1.0
        ) * 100
      )
    );


  /*
   * Review score.
   *
   * Logarithmic so a city with millions of reviews
   * doesn't automatically beat everything else.
   */

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


  /*
   * Rating is still the most important factor.
   */

  return (

    ratingScore * 0.70 +

    reviewScore * 0.30

  );

}


// =========================================================
// SEARCH GOOGLE PLACES
// =========================================================

async function searchGoogle(
  query,
  apiKey
) {

  const response =
    await fetch(
      GOOGLE_PLACES_URL,
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "X-Goog-Api-Key":
            apiKey,

          "X-Goog-FieldMask":
            FIELD_MASK

        },

        body: JSON.stringify({

          textQuery:
            query,

          maxResultCount:
            MAX_GOOGLE_RESULTS_PER_SEARCH,

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
// BUILD TOP CITIES
// =========================================================

async function buildTopCities(
  apiKey,
  requestedLimit
) {

  const cityMap =
    new Map();


  /*
   * =======================================================
   * RUN DISCOVERY SEARCHES
   * =======================================================
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
   * =======================================================
   * PROCESS GOOGLE RESULTS
   * =======================================================
   */

  for (
    const response
    of responses
  ) {

    if (
      response.status !==
      "fulfilled"
    ) {

      continue;

    }


    const places =
      response
        .value
        ?.places || [];


    for (
      const place
      of places
    ) {


      // ===================================================
      // CITY FILTER
      // ===================================================
      //
      // If Google says this is not a city,
      // it never gets added.
      //
      // ===================================================

      if (
        !isCity(
          place
        )
      ) {

        continue;

      }


      const city =
        extractCity(
          place
        );


      const country =
        extractCountry(
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


      const reviewCount =
        Number(
          place.userRatingCount
        ) || 0;


      /*
       * If Google does not have a rating,
       * don't use the result.
       */

      if (
        rating < MIN_RATING
      ) {

        continue;

      }


      /*
       * Minimum review count.
       */

      if (
        reviewCount < MIN_REVIEWS
      ) {

        continue;

      }


      const cityKey =
        `${normalize(city)}|${normalize(country)}`;


      const score =
        calculateCityScore(
          rating,
          reviewCount
        );


      // ===================================================
      // NEW CITY
      // ===================================================

      if (
        !cityMap.has(
          cityKey
        )
      ) {

        cityMap.set(

          cityKey,

          {

            city,

            country,

            rating,

            reviewCount,

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
              place.photos?.[0]
                ?.name ||
              null,

            photoAttributions:
              place.photos?.[0]
                ?.authorAttributions ||
              [],

            placeTypes:
              place.types ||
              []

          }

        );


        continue;

      }


      // ===================================================
      // EXISTING CITY
      // ===================================================

      const existing =
        cityMap.get(
          cityKey
        );


      existing.appearances += 1;


      /*
       * A city appearing in multiple discovery searches
       * is useful confirmation that it is a major destination.
       */

      existing.score +=
        score * 0.10;


      /*
       * Keep the strongest Google result for the city.
       */

      const existingScore =
        calculateCityScore(
          existing.rating,
          existing.reviewCount
        );


      if (
        score >
        existingScore
      ) {

        existing.rating =
          rating;


        existing.reviewCount =
          reviewCount;


        existing.placeId =
          place.id ||
          existing.placeId;


        existing.googleMapsUrl =
          place.googleMapsUri ||
          existing.googleMapsUrl;


        existing.photoName =
          place.photos?.[0]
            ?.name ||
          existing.photoName;


        existing.photoAttributions =
          place.photos?.[0]
            ?.authorAttributions ||
          existing.photoAttributions;


        existing.placeTypes =
          place.types ||
          existing.placeTypes;

      }


    }

  }


  // =======================================================
  // CONVERT MAP TO ARRAY
  // =======================================================

  const cities =
    Array.from(
      cityMap.values()
    );


  // =======================================================
  // SORT
  // =======================================================

  cities.sort(
    (
      a,
      b
    ) => {

      /*
       * Score first.
       */

      if (
        b.score !==
        a.score
      ) {

        return (
          b.score -
          a.score
        );

      }


      /*
       * Rating second.
       */

      if (
        b.rating !==
        a.rating
      ) {

        return (
          b.rating -
          a.rating
        );

      }


      /*
       * Reviews third.
       */

      return (
        b.reviewCount -
        a.reviewCount
      );

    }
  );


  // =======================================================
  // RETURN TOP CITIES
  // =======================================================

  return cities

    .slice(
      0,
      requestedLimit
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

        /*
         * Useful for debugging.
         *
         * This lets you confirm that the result
         * actually came from a city-type Google result.
         */

        googleTypes:
          city.placeTypes

      })

    );

}


// =========================================================
// PHOTO PROXY
// =========================================================

async function getGooglePhoto(
  photoName,
  apiKey
) {

  /*
   * Security validation.
   */

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


  const googlePhotoUrl =
    `https://places.googleapis.com/v1/${photoName}/media` +
    `?maxWidthPx=1000` +
    `&maxHeightPx=1000` +
    `&key=${encodeURIComponent(
      apiKey
    )}`;


  const response =
    await fetch(
      googlePhotoUrl,
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
// API HANDLER
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
  // GET ONLY
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
  // GOOGLE API KEY
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
  // PHOTO REQUEST
  // =======================================================

  const photo =
    req.query?.photo;


  if (photo) {

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

  let requestedLimit =
    Number(
      req.query?.limit
    );


  if (
    !Number.isFinite(
      requestedLimit
    )
  ) {

    requestedLimit =
      DEFAULT_LIMIT;

  }


  requestedLimit =
    Math.floor(
      requestedLimit
    );


  /*
   * Never allow more than 50.
   */

  requestedLimit =
    Math.max(
      1,
      Math.min(
        50,
        requestedLimit
      )
    );


  // =======================================================
  // CACHE
  // =======================================================

  const now =
    Date.now();


  /*
   * If cache contains enough cities,
   * use it.
   */

  if (
    citiesCache &&
    citiesCacheExpires > now &&
    citiesCache.length >= requestedLimit
  ) {

    return res
      .status(200)
      .json({

        success:
          true,

        cached:
          true,

        count:
          requestedLimit,

        cities:
          citiesCache.slice(
            0,
            requestedLimit
          )

      });

  }


  // =======================================================
  // BUILD CITY LIST
  // =======================================================

  try {

    const cities =
      await buildTopCities(
        apiKey,
        DEFAULT_LIMIT
      );


    // =====================================================
    // VERIFY WE ACTUALLY HAVE CITIES
    // =====================================================

    if (
      !cities.length
    ) {

      throw new Error(
        "Google Places did not return any qualifying cities."
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
            requestedLimit,
            cities.length
          ),

        cities:
          cities.slice(
            0,
            requestedLimit
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
