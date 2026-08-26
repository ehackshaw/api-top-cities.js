/**
 * =========================================================
 * BOKKARA — TOP 50 CITIES API
 * =========================================================
 *
 * GOOGLE MAPS PLATFORM ONLY
 *
 * Required environment variable:
 *
 * GOOGLE_PLACES_API_KEY
 *
 * No GeoNames.
 * No second API key.
 *
 *
 * ENDPOINT:
 *
 * GET /api/top-cities
 *
 *
 * PHOTO:
 *
 * GET /api/top-cities?photo=PHOTO_RESOURCE_NAME
 *
 * =========================================================
 *
 * ARCHITECTURE
 *
 * Google Places Autocomplete
 *          ↓
 *      Real cities
 *          ↓
 *   City + country + placeId
 *          ↓
 * Google Place Details
 *          ↓
 * Rating + reviews + photo + Maps URL
 *          ↓
 *       Ranking
 *          ↓
 *       Top 50
 *
 * =========================================================
 */


// =========================================================
// GOOGLE API
// =========================================================

const GOOGLE_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";

const GOOGLE_DETAILS_URL =
  "https://places.googleapis.com/v1/places";

const GOOGLE_PHOTO_BASE_URL =
  "https://places.googleapis.com/v1";


// =========================================================
// SETTINGS
// =========================================================

const DEFAULT_LIMIT = 50;

const MAX_CITY_CANDIDATES = 120;

const CACHE_DURATION =
  1000 * 60 * 60 * 6;

const DETAILS_CONCURRENCY = 8;


// =========================================================
// CITY DISCOVERY QUERIES
// =========================================================
//
// These are NOT hardcoded cities.
//
// They are geographic discovery terms.
//
// Google Autocomplete is restricted to
// the `(cities)` primary type.
//
// =========================================================

const CITY_DISCOVERY_QUERIES = [

  "cities",

  "major cities",

  "famous cities",

  "best cities",

  "travel cities",

  "tourist cities",

  "world cities",

  "cities in North America",

  "cities in South America",

  "cities in Europe",

  "cities in Asia",

  "cities in Africa",

  "cities in Australia",

  "cities in Oceania",

  "cities in the Caribbean",

  "cities in Central America",

  "cities in United States",

  "cities in Canada",

  "cities in Mexico",

  "cities in Brazil",

  "cities in Argentina",

  "cities in Colombia",

  "cities in Peru",

  "cities in Chile",

  "cities in United Kingdom",

  "cities in France",

  "cities in Spain",

  "cities in Italy",

  "cities in Germany",

  "cities in Portugal",

  "cities in Greece",

  "cities in Netherlands",

  "cities in Switzerland",

  "cities in Austria",

  "cities in Turkey",

  "cities in Japan",

  "cities in South Korea",

  "cities in China",

  "cities in Thailand",

  "cities in Singapore",

  "cities in Indonesia",

  "cities in Malaysia",

  "cities in Vietnam",

  "cities in Philippines",

  "cities in India",

  "cities in United Arab Emirates",

  "cities in South Africa",

  "cities in Egypt",

  "cities in Morocco"

];


// =========================================================
// AUTOCOMPLETE FIELD MASK
// =========================================================
//
// We only need the prediction information needed
// to identify cities.
//
// =========================================================

const AUTOCOMPLETE_FIELD_MASK = [

  "suggestions.placePrediction.placeId",

  "suggestions.placePrediction.text",

  "suggestions.placePrediction.structuredFormat",

  "suggestions.placePrediction.types"

].join(",");


// =========================================================
// PLACE DETAILS FIELD MASK
// =========================================================

const DETAILS_FIELD_MASK = [

  "id",

  "displayName",

  "formattedAddress",

  "shortFormattedAddress",

  "addressComponents",

  "location",

  "rating",

  "userRatingCount",

  "photos",

  "googleMapsUri",

  "types",

  "primaryType",

  "businessStatus"

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
// AUTOCOMPLETE CITY DISCOVERY
// =========================================================

async function discoverCities(
  query,
  apiKey
) {

  const response =
    await fetch(
      GOOGLE_AUTOCOMPLETE_URL,
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "X-Goog-Api-Key":
            apiKey,

          "X-Goog-FieldMask":
            AUTOCOMPLETE_FIELD_MASK

        },

        body:
          JSON.stringify({

            input:
              query,

            includedPrimaryTypes: [

              "(cities)"

            ],

            includeQueryPredictions:
              false,

            languageCode:
              "en"

          })

      }
    );


  if (
    !response.ok
  ) {

    const error =
      await response.text();


    throw new Error(
      `Google Autocomplete ${response.status}: ${error}`
    );

  }


  const data =
    await response.json();


  return (
    data?.suggestions ||
    []
  );

}


// =========================================================
// EXTRACT PREDICTION
// =========================================================

function extractCityPrediction(
  suggestion
) {

  const prediction =
    suggestion?.placePrediction;


  if (
    !prediction
  ) {

    return null;

  }


  const placeId =
    prediction.placeId;


  if (
    !placeId
  ) {

    return null;

  }


  const types =
    prediction.types ||
    [];


  /*
   * We explicitly require the city type.
   */

  if (
    !types.includes(
      "locality"
    ) &&
    !types.includes(
      "administrative_area_level_1"
    ) &&
    !types.includes(
      "postal_town"
    )
  ) {

    /*
     * Google may return the `(cities)` prediction
     * without exposing the same exact type in every
     * response, so we don't immediately reject it.
     */

  }


  const mainText =
    prediction
      ?.structuredFormat
      ?.mainText
      ?.text ||
    prediction
      ?.text
      ?.text ||
    "";


  const secondaryText =
    prediction
      ?.structuredFormat
      ?.secondaryText
      ?.text ||
    "";


  if (
    !mainText
  ) {

    return null;

  }


  return {

    placeId,

    city:
      mainText,

    context:
      secondaryText,

    types

  };

}


// =========================================================
// COLLECT CITY CANDIDATES
// =========================================================

async function collectCityCandidates(
  apiKey
) {

  const cityMap =
    new Map();


  /*
   * Run discovery queries in parallel.
   */

  const responses =
    await Promise.allSettled(

      CITY_DISCOVERY_QUERIES.map(
        query =>
          discoverCities(
            query,
            apiKey
          )
      )

    );


  /*
   * Process every successful search.
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


    const suggestions =
      response.value ||
      [];


    for (
      const suggestion
      of suggestions
    ) {

      const city =
        extractCityPrediction(
          suggestion
        );


      if (
        !city
      ) {

        continue;

      }


      /*
       * Use Google place ID as the
       * unique identifier.
       */

      if (
        cityMap.has(
          city.placeId
        )
      ) {

        continue;

      }


      cityMap.set(

        city.placeId,

        city

      );

    }

  }


  /*
   * Return candidates.
   */

  return Array.from(
    cityMap.values()
  )
    .slice(
      0,
      MAX_CITY_CANDIDATES
    );

}


// =========================================================
// PLACE DETAILS
// =========================================================

async function getPlaceDetails(
  placeId,
  apiKey
) {

  const response =
    await fetch(

      `${GOOGLE_DETAILS_URL}/${encodeURIComponent(
        placeId
      )}`,

      {

        method:
          "GET",

        headers: {

          "X-Goog-Api-Key":
            apiKey,

          "X-Goog-FieldMask":
            DETAILS_FIELD_MASK

        }

      }

    );


  if (
    !response.ok
  ) {

    return null;

  }


  return response.json();

}


// =========================================================
// EXTRACT ADDRESS COMPONENT
// =========================================================

function getAddressComponent(
  place,
  wantedTypes
) {

  const components =
    place?.addressComponents ||
    [];


  for (
    const component
    of components
  ) {

    const types =
      component.types ||
      [];


    if (
      wantedTypes.some(
        type =>
          types.includes(
            type
          )
      )
    ) {

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
// EXTRACT COUNTRY
// =========================================================

function getCountry(
  place
) {

  return getAddressComponent(
    place,
    [
      "country"
    ]
  );

}


// =========================================================
// EXTRACT COUNTRY CODE
// =========================================================

function getCountryCode(
  place
) {

  return getAddressComponent(
    place,
    [
      "country"
    ]
  );

}


// =========================================================
// EXTRACT CITY
// =========================================================

function getCity(
  place
) {

  const city =
    getAddressComponent(
      place,
      [
        "locality",
        "postal_town"
      ]
    );


  if (
    city
  ) {

    return city;

  }


  /*
   * Google can use administrative areas
   * in some regions.
   */

  return getAddressComponent(
    place,
    [
      "administrative_area_level_2"
    ]
  );

}


// =========================================================
// DISTANCE
// =========================================================
//
// Distance from city isn't required because Google
// already identified the city. This function is kept
// available if we want geographic scoring later.
//
// =========================================================

function calculateDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {

  if (
    !Number.isFinite(
      lat1
    ) ||
    !Number.isFinite(
      lon1
    ) ||
    !Number.isFinite(
      lat2
    ) ||
    !Number.isFinite(
      lon2
    )
  ) {

    return Infinity;

  }


  const earthRadius =
    6371;


  const dLat =
    (
      lat2 -
      lat1
    ) *
    Math.PI /
    180;


  const dLon =
    (
      lon2 -
      lon1
    ) *
    Math.PI /
    180;


  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      lat1 *
      Math.PI /
      180
    ) *

    Math.cos(
      lat2 *
      Math.PI /
      180
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;


  return (
    earthRadius *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(
        1 - a
      )
    )
  );

}


// =========================================================
// DESTINATION SCORE
// =========================================================

function calculateDestinationScore(
  city
) {

  const rating =
    Number(
      city.rating
    ) || 0;


  const reviews =
    Number(
      city.reviewCount
    ) || 0;


  /*
   * Rating is the strongest signal.
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
          (rating - 4) /
          1
        ) * 100
      )
    );


  /*
   * Reviews establish confidence.
   */

  const reviewScore =
    Math.min(
      100,
      (
        Math.log10(
          Math.max(
            1,
            reviews
          )
        ) /
        6
      ) *
      100
    );


  /*
   * A small bonus for having a photo.
   */

  const photoScore =
    city.photoName
      ? 10
      : 0;


  return (

    ratingScore * 0.65 +

    reviewScore * 0.25 +

    photoScore * 0.10

  );

}


// =========================================================
// VALID GOOGLE CITY
// =========================================================

function isValidCity(
  place
) {

  if (
    !place
  ) {

    return false;

  }


  /*
   * We require a city/locality address.
   */

  const city =
    getCity(
      place
    );


  if (
    !city
  ) {

    return false;

  }


  /*
   * We require a country.
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


  /*
   * We need a rating.
   */

  const rating =
    Number(
      place.rating
    ) || 0;


  if (
    rating <= 0
  ) {

    return false;

  }


  /*
   * We need a photo.
   */

  const photo =
    place.photos?.[0]
      ?.name ||
    null;


  if (
    !photo
  ) {

    return false;

  }


  return true;

}


// =========================================================
// ENRICH ONE CITY
// =========================================================

async function enrichCity(
  candidate,
  apiKey
) {

  const place =
    await getPlaceDetails(
      candidate.placeId,
      apiKey
    );


  if (
    !isValidCity(
      place
    )
  ) {

    return null;

  }


  const city =
    getCity(
      place
    );


  const country =
    getCountry(
      place
    );


  const rating =
    Number(
      place.rating
    ) || 0;


  const reviewCount =
    Number(
      place.userRatingCount
    ) || 0;


  /*
   * We don't require a huge review count.
   *
   * Google city/locality records can have different
   * review behavior depending on country.
   */

  if (
    rating <
    4.0
  ) {

    return null;

  }


  return {

    city,

    country,

    countryCode:
      getAddressComponent(
        place,
        [
          "country"
        ]
      ),

    latitude:
      place.location
        ?.latitude ||
      null,

    longitude:
      place.location
        ?.longitude ||
      null,

    rating,

    reviewCount,

    placeId:
      place.id ||
      candidate.placeId,

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

    googleName:
      place.displayName?.text ||
      city,

    googleTypes:
      place.types ||
      [],

    primaryType:
      place.primaryType ||
      null,

    score:
      calculateDestinationScore({

        rating,

        reviewCount,

        photoName:
          place.photos?.[0]
            ?.name

      })

  };

}


// =========================================================
// CONCURRENCY
// =========================================================

async function mapWithConcurrency(
  items,
  worker,
  concurrency
) {

  const results =
    new Array(
      items.length
    );


  let index =
    0;


  async function runner() {

    while (
      true
    ) {

      const current =
        index++;


      if (
        current >=
        items.length
      ) {

        return;

      }


      try {

        results[current] =
          await worker(
            items[current],
            current
          );

      } catch (
        error
      ) {

        console.error(
          "City enrichment error:",
          error
        );


        results[current] =
          null;

      }

    }

  }


  const runners =
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            items.length
          )
      },
      () =>
        runner()
    );


  await Promise.all(
    runners
  );


  return results;

}


// =========================================================
// BUILD TOP CITIES
// =========================================================

async function buildTopCities(
  apiKey
) {

  /*
   * =======================================================
   * STEP 1
   * =======================================================
   *
   * Discover actual cities through Google.
   */

  const candidates =
    await collectCityCandidates(
      apiKey
    );


  console.log(
    `Google discovered ${candidates.length} city candidates.`
  );


  /*
   * =======================================================
   * STEP 2
   * =======================================================
   *
   * Get Google details for each city.
   */

  const enriched =
    await mapWithConcurrency(

      candidates,

      async (
        candidate
      ) => {

        return enrichCity(
          candidate,
          apiKey
        );

      },

      DETAILS_CONCURRENCY

    );


  /*
   * Remove invalid cities.
   */

  const cities =
    enriched.filter(
      Boolean
    );


  /*
   * =======================================================
   * DEDUPLICATE
   * =======================================================
   */

  const cityMap =
    new Map();


  for (
    const city
    of cities
  ) {

    const key =
      `${normalize(city.city)}|${normalize(city.country)}`;


    const existing =
      cityMap.get(
        key
      );


    if (
      !existing ||
      city.score >
      existing.score
    ) {

      cityMap.set(
        key,
        city
      );

    }

  }


  const uniqueCities =
    Array.from(
      cityMap.values()
    );


  /*
   * =======================================================
   * SORT
   * =======================================================
   */

  uniqueCities.sort(
    (
      a,
      b
    ) => {

      /*
       * Highest score first.
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
       * Rating tie breaker.
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
       * Review tie breaker.
       */

      return (
        b.reviewCount -
        a.reviewCount
      );

    }
  );


  /*
   * =======================================================
   * TOP 50
   * =======================================================
   */

  return uniqueCities

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

        countryCode:
          city.countryCode,

        latitude:
          city.latitude,

        longitude:
          city.longitude,

        rating:
          Number(
            city.rating.toFixed(1)
          ),

        reviewCount:
          city.reviewCount,

        placeId:
          city.placeId,

        googleMapsUrl:
          city.googleMapsUrl,

        photoName:
          city.photoName,

        photoAttributions:
          city.photoAttributions,

        googleName:
          city.googleName,

        googleTypes:
          city.googleTypes,

        primaryType:
          city.primaryType,

        score:
          Number(
            city.score.toFixed(2)
          )

      })

    );

}


// =========================================================
// GOOGLE PHOTO PROXY
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


  const photoUrl =
    `${GOOGLE_PHOTO_BASE_URL}/${photoName}/media` +

    `?maxWidthPx=1200` +

    `&maxHeightPx=1200` +

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


  if (
    !apiKey
  ) {

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
            "Unable to retrieve photo.",

          message:
            error.message

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
    citiesCacheExpires >
      now &&
    citiesCache.length >=
      limit
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
     * Don't silently return an empty list.
     */

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
