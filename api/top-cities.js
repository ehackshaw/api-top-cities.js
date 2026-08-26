/**
 * =========================================================
 * BOKKARA — TOP 50 CITIES API
 * =========================================================
 *
 * CITY SOURCE:
 * GeoNames
 *
 * ENRICHMENT:
 * Google Places
 *
 * ENDPOINT:
 *
 * GET /api/top-cities
 *
 * OPTIONAL:
 *
 * GET /api/top-cities?limit=50
 *
 * PHOTO:
 *
 * GET /api/top-cities?photo=PHOTO_RESOURCE_NAME
 *
 * =========================================================
 *
 * ARCHITECTURE
 *
 * GeoNames
 *    ↓
 * Real cities
 *    ↓
 * City + Country + Coordinates
 *    ↓
 * Google Places
 *    ↓
 * Rating + Reviews + Photo + Maps
 *    ↓
 * Top 50 destinations
 *
 * =========================================================
 */


// =========================================================
// API URLS
// =========================================================

const GOOGLE_PLACES_URL =
  "https://places.googleapis.com/v1/places:searchText";

const GEONAMES_CITIES_URL =
  "https://secure.geonames.org/citiesJSON";


// =========================================================
// SETTINGS
// =========================================================

const DEFAULT_LIMIT = 50;

const MAX_CITY_CANDIDATES = 150;

const MIN_POPULATION = 100000;

const MIN_RATING = 4.0;

const MIN_REVIEWS = 25;

const GOOGLE_RESULTS_PER_CITY = 5;

const GOOGLE_SEARCH_CONCURRENCY = 8;

const CACHE_DURATION =
  1000 * 60 * 60 * 6;


// =========================================================
// WORLD REGIONS
// =========================================================
//
// GeoNames citiesJSON works with geographic bounding boxes.
//
// These regions allow us to discover cities worldwide without
// hardcoding individual city names.
//
// =========================================================

const WORLD_REGIONS = [

  {
    name: "North America",

    north: 83,

    south: 7,

    east: -20,

    west: -170
  },

  {
    name: "South America",

    north: 13,

    south: -56,

    east: -34,

    west: -82
  },

  {
    name: "Europe",

    north: 72,

    south: 34,

    east: 45,

    west: -25
  },

  {
    name: "Asia",

    north: 80,

    south: -10,

    east: 180,

    west: 25
  },

  {
    name: "Africa",

    north: 38,

    south: -35,

    east: 52,

    west: -18
  },

  {
    name: "Oceania",

    north: 0,

    south: -50,

    east: 180,

    west: 110
  }

];


// =========================================================
// GOOGLE FIELD MASK
// =========================================================
//
// Only request fields we actually need.
//
// Google requires an explicit field mask.
// =========================================================

const GOOGLE_FIELD_MASK = [

  "places.id",

  "places.displayName",

  "places.formattedAddress",

  "places.location",

  "places.rating",

  "places.userRatingCount",

  "places.photos",

  "places.googleMapsUri",

  "places.types",

  "places.primaryType"

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
// GEONAMES REQUEST
// =========================================================

async function getGeoNamesCities(
  region,
  username
) {

  const url =
    new URL(
      GEONAMES_CITIES_URL
    );


  url.searchParams.set(
    "north",
    region.north
  );


  url.searchParams.set(
    "south",
    region.south
  );


  url.searchParams.set(
    "east",
    region.east
  );


  url.searchParams.set(
    "west",
    region.west
  );


  /*
   * GeoNames supports cities1000,
   * which returns populated places with
   * at least 1,000 inhabitants.
   *
   * We apply our own higher population
   * filter afterward.
   */

  url.searchParams.set(
    "cities",
    "cities1000"
  );


  url.searchParams.set(
    "maxRows",
    "500"
  );


  url.searchParams.set(
    "lang",
    "en"
  );


  url.searchParams.set(
    "username",
    username
  );


  const response =
    await fetch(
      url.toString()
    );


  if (
    !response.ok
  ) {

    const error =
      await response.text();


    throw new Error(
      `GeoNames ${response.status}: ${error}`
    );

  }


  const data =
    await response.json();


  return data?.geonames || [];

}


// =========================================================
// COLLECT WORLD CITIES
// =========================================================

async function collectWorldCities(
  username
) {

  const cityMap =
    new Map();


  /*
   * Search every region.
   */

  const responses =
    await Promise.allSettled(

      WORLD_REGIONS.map(
        region =>
          getGeoNamesCities(
            region,
            username
          )
      )

    );


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


    const cities =
      response.value || [];


    for (
      const city
      of cities
    ) {

      /*
       * ===================================================
       * BASIC VALIDATION
       * ===================================================
       */

      if (
        !city.name ||
        !city.countryName ||
        !city.lat ||
        !city.lng
      ) {

        continue;

      }


      const population =
        Number(
          city.population
        ) || 0;


      /*
       * Ignore small towns.
       */

      if (
        population <
        MIN_POPULATION
      ) {

        continue;

      }


      /*
       * GeoNames feature class P =
       * populated place.
       */

      if (
        city.fcl &&
        city.fcl !== "P"
      ) {

        continue;

      }


      const key =
        `${normalize(city.name)}|${normalize(city.countryName)}`;


      /*
       * Avoid duplicates.
       */

      if (
        cityMap.has(
          key
        )
      ) {

        continue;

      }


      cityMap.set(

        key,

        {

          name:
            city.name,

          country:
            city.countryName,

          countryCode:
            city.countryCode ||
            "",

          latitude:
            Number(
              city.lat
            ),

          longitude:
            Number(
              city.lng
            ),

          population,

          geonameId:
            city.geonameId ||
            null,

          adminName:
            city.adminName1 ||
            ""

        }

      );

    }

  }


  /*
   * =======================================================
   * SORT CITIES
   * =======================================================
   *
   * Population is used only to determine which cities
   * are worth enriching with Google Places.
   *
   * Google will determine the destination quality score.
   *
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

      return (
        b.population -
        a.population
      );

    }
  );


  return cities.slice(
    0,
    MAX_CITY_CANDIDATES
  );

}


// =========================================================
// GOOGLE SEARCH FOR CITY
// =========================================================
//
// Google is NOT being used to discover the city.
//
// We already know the city from GeoNames.
//
// Google is only enriching the city.
//
// =========================================================

async function enrichCityWithGoogle(
  city,
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
            GOOGLE_FIELD_MASK

        },

        body:
          JSON.stringify({

            /*
             * Explicit city + country query.
             */

            textQuery:
              `${city.name}, ${city.country}`,

            /*
             * Coordinate bias keeps Google focused
             * around the actual GeoNames city.
             */

            locationBias: {

              circle: {

                center: {

                  latitude:
                    city.latitude,

                  longitude:
                    city.longitude

                },

                radius:
                  50000

              }

            },

            pageSize:
              GOOGLE_RESULTS_PER_CITY

          })

      }

    );


  if (
    !response.ok
  ) {

    return null;

  }


  const data =
    await response.json();


  const places =
    data?.places || [];


  if (
    !places.length
  ) {

    return null;

  }


  /*
   * =======================================================
   * CHOOSE BEST GOOGLE RESULT
   * =======================================================
   *
   * We do NOT blindly take the first result.
   *
   * We score the results based on:
   *
   * - Distance to city coordinates
   * - Rating
   * - Review count
   * - Whether the result looks geographic
   *
   * =======================================================
   */

  let bestPlace =
    null;

  let bestScore =
    -Infinity;


  for (
    const place
    of places
  ) {

    const rating =
      Number(
        place.rating
      ) || 0;


    const reviews =
      Number(
        place.userRatingCount
      ) || 0;


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

      continue;

    }


    /*
     * Don't use obvious attractions as the
     * representative Google result.
     */

    const types =
      place.types || [];


    const blockedTypes = [

      "park",

      "museum",

      "restaurant",

      "cafe",

      "bar",

      "hotel",

      "tourist_attraction",

      "shopping_mall",

      "airport",

      "stadium",

      "aquarium",

      "zoo",

      "art_gallery",

      "night_club",

      "casino",

      "spa",

      "store"

    ];


    const blocked =
      types.some(
        type =>
          blockedTypes.includes(
            type
          )
      );


    if (
      blocked
    ) {

      continue;

    }


    /*
     * Rating filter.
     */

    if (
      rating <
      MIN_RATING
    ) {

      continue;

    }


    /*
     * Review filter.
     */

    if (
      reviews <
      MIN_REVIEWS
    ) {

      continue;

    }


    /*
     * ===================================================
     * DISTANCE
     * ===================================================
     */

    const placeLat =
      Number(
        place.location?.latitude
      );


    const placeLng =
      Number(
        place.location?.longitude
      );


    let distancePenalty =
      0;


    if (
      Number.isFinite(
        placeLat
      ) &&
      Number.isFinite(
        placeLng
      )
    ) {

      const distance =
        calculateDistance(
          city.latitude,
          city.longitude,
          placeLat,
          placeLng
        );


      /*
       * Strongly prefer results close to the city center.
       */

      distancePenalty =
        Math.min(
          50,
          distance / 2
        );

    }


    /*
     * ===================================================
     * SCORE
     * ===================================================
     */

    const ratingScore =
      rating * 20;


    const reviewScore =
      Math.min(
        30,
        Math.log10(
          Math.max(
            1,
            reviews
          )
        ) * 5
      );


    const score =
      ratingScore +
      reviewScore -
      distancePenalty;


    if (
      score >
      bestScore
    ) {

      bestScore =
        score;


      bestPlace =
        place;

    }

  }


  if (
    !bestPlace
  ) {

    return null;

  }


  return {

    rating:
      Number(
        bestPlace.rating
      ) || 0,

    reviewCount:
      Number(
        bestPlace.userRatingCount
      ) || 0,

    placeId:
      bestPlace.id ||
      null,

    googleMapsUrl:
      bestPlace.googleMapsUri ||
      null,

    photoName:
      bestPlace.photos?.[0]
        ?.name ||
      null,

    photoAttributions:
      bestPlace.photos?.[0]
        ?.authorAttributions ||
      [],

    googleName:
      bestPlace.displayName?.text ||
      "",

    googleTypes:
      bestPlace.types ||
      [],

    googleLocation:
      bestPlace.location ||
      null

  };

}


// =========================================================
// DISTANCE
// =========================================================
//
// Haversine distance in kilometers.
//
// =========================================================

function calculateDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const earthRadius =
    6371;


  const dLat =
    toRadians(
      lat2 -
      lat1
    );


  const dLon =
    toRadians(
      lon2 -
      lon1
    );


  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      toRadians(lat1)
    ) *

    Math.cos(
      toRadians(lat2)
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;


  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(
        1 - a
      )
    );


  return (
    earthRadius *
    c
  );

}


function toRadians(
  degrees
) {

  return (
    degrees *
    Math.PI /
    180
  );

}


// =========================================================
// CONCURRENCY HELPER
// =========================================================
//
// Prevents sending 150 Google requests simultaneously.
//
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


  let currentIndex =
    0;


  async function runner() {

    while (true) {

      const index =
        currentIndex++;


      if (
        index >=
        items.length
      ) {

        return;

      }


      try {

        results[index] =
          await worker(
            items[index],
            index
          );

      } catch (
        error
      ) {

        results[index] =
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
  googleApiKey,
  geonamesUsername
) {

  /*
   * =======================================================
   * STEP 1
   * =======================================================
   *
   * Get actual cities.
   *
   */

  const candidateCities =
    await collectWorldCities(
      geonamesUsername
    );


  /*
   * =======================================================
   * STEP 2
   * =======================================================
   *
   * Enrich those cities with Google.
   *
   */

  const enrichedCities =
    await mapWithConcurrency(

      candidateCities,

      async (
        city
      ) => {

        const google =
          await enrichCityWithGoogle(
            city,
            googleApiKey
          );


        if (
          !google
        ) {

          return null;

        }


        /*
         * Final city record.
         */

        return {

          city:
            city.name,

          country:
            city.country,

          countryCode:
            city.countryCode,

          latitude:
            city.latitude,

          longitude:
            city.longitude,

          population:
            city.population,

          geonameId:
            city.geonameId,

          rating:
            google.rating,

          reviewCount:
            google.reviewCount,

          placeId:
            google.placeId,

          googleMapsUrl:
            google.googleMapsUrl,

          photoName:
            google.photoName,

          photoAttributions:
            google.photoAttributions,

          googleName:
            google.googleName,

          googleTypes:
            google.googleTypes,

          googleLocation:
            google.googleLocation

        };

      },

      GOOGLE_SEARCH_CONCURRENCY

    );


  /*
   * Remove failed results.
   */

  const validCities =
    enrichedCities.filter(
      Boolean
    );


  /*
   * =======================================================
   * RANK
   * =======================================================
   *
   * Rating is the primary factor.
   *
   * Review count helps distinguish a genuinely popular
   * highly-rated destination from a city with only a few
   * reviews.
   *
   * Population is a small additional signal.
   *
   * =======================================================
   */

  validCities.sort(
    (
      a,
      b
    ) => {

      const scoreA =
        calculateDestinationScore(
          a
        );


      const scoreB =
        calculateDestinationScore(
          b
        );


      return (
        scoreB -
        scoreA
      );

    }
  );


  /*
   * =======================================================
   * TOP 50
   * =======================================================
   */

  return validCities

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

        population:
          city.population,

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
          city.googleTypes

      })

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


  const population =
    Number(
      city.population
    ) || 0;


  /*
   * Rating:
   *
   * 4.0 → 0
   * 5.0 → 100
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
   * Review confidence.
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
        ) / 6
      ) * 100
    );


  /*
   * Population is intentionally weak.
   *
   * We don't want only giant cities.
   */

  const populationScore =
    Math.min(
      100,
      (
        Math.log10(
          Math.max(
            1,
            population
          )
        ) / 7
      ) * 100
    );


  return (

    ratingScore * 0.60 +

    reviewScore * 0.30 +

    populationScore * 0.10

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
   * Validate resource name.
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
  // API KEYS
  // =======================================================

  const googleApiKey =
    process.env.GOOGLE_PLACES_API_KEY;


  const geonamesUsername =
    process.env.GEONAMES_USERNAME;


  if (
    !googleApiKey
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


  if (
    !geonamesUsername
  ) {

    return res
      .status(500)
      .json({

        success:
          false,

        error:
          "GEONAMES_USERNAME is missing."

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
          googleApiKey
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
        googleApiKey,
        geonamesUsername
      );


    if (
      !cities.length
    ) {

      throw new Error(
        "No cities could be enriched with Google Places."
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
