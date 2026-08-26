lets redo the backend end 

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
 */

const GOOGLE_PLACES_URL =
  "https://places.googleapis.com/v1/places:searchText";


// =========================================================
// SETTINGS
// =========================================================

const DEFAULT_LIMIT = 50;

const MIN_RATING = 4.5;

const MIN_REVIEWS = 100;

const CACHE_DURATION =
  1000 * 60 * 60 * 6;


// =========================================================
// GOOGLE SEARCH QUERIES
// =========================================================
//
// These are discovery searches, NOT hardcoded cities.
//
// Google discovers the actual destinations.
//
// =========================================================

const SEARCH_QUERIES = [

  "top tourist attractions in North America",

  "top tourist attractions in South America",

  "top tourist attractions in Europe",

  "top tourist attractions in Asia",

  "top tourist attractions in Africa",

  "top tourist attractions in Australia",

  "top tourist attractions in New Zealand",

  "best tourist destinations in United States",

  "best tourist destinations in Canada",

  "best tourist destinations in Mexico",

  "best tourist destinations in Caribbean",

  "best tourist destinations in Brazil",

  "best tourist destinations in Argentina",

  "best tourist destinations in Colombia",

  "best tourist destinations in Peru",

  "best tourist destinations in Chile",

  "best tourist destinations in United Kingdom",

  "best tourist destinations in France",

  "best tourist destinations in Italy",

  "best tourist destinations in Spain",

  "best tourist destinations in Germany",

  "best tourist destinations in Greece",

  "best tourist destinations in Portugal",

  "best tourist destinations in Japan",

  "best tourist destinations in Thailand",

  "best tourist destinations in Singapore",

  "best tourist destinations in Indonesia",

  "best tourist destinations in South Korea",

  "best tourist destinations in United Arab Emirates",

  "best tourist destinations in South Africa",

  "best tourist destinations in Egypt",

  "best tourist destinations in Morocco"

];


// =========================================================
// GOOGLE FIELD MASK
// =========================================================

const FIELD_MASK = [

  "places.id",

  "places.displayName",

  "places.formattedAddress",

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
// EXTRACT COUNTRY
// =========================================================

function extractCountry(address) {

  if (!address) {
    return "";
  }

  const parts =
    address
      .split(",")
      .map(part => part.trim())
      .filter(Boolean);

  if (parts.length >= 2) {

    return parts[
      parts.length - 1
    ];

  }

  return "";

}


// =========================================================
// EXTRACT CITY
// =========================================================

function extractCity(address) {

  if (!address) {
    return "";
  }

  const parts =
    address
      .split(",")
      .map(part => part.trim())
      .filter(Boolean);


  if (parts.length >= 3) {

    return parts[
      parts.length - 2
    ];

  }


  if (parts.length === 2) {

    return parts[0];

  }


  return "";

}


// =========================================================
// CALCULATE PLACE SCORE
// =========================================================

function calculatePlaceScore(
  rating,
  reviewCount
) {

  const safeRating =
    Number(rating) || 0;

  const safeReviews =
    Number(reviewCount) || 0;


  /*
   * Rating score:
   *
   * 4.5 = 0
   * 5.0 = 100
   */

  const ratingScore =
    Math.max(
      0,
      Math.min(
        100,
        (
          (safeRating - 4.5) /
          0.5
        ) * 100
      )
    );


  /*
   * Review score:
   *
   * Uses logarithmic scaling so
   * extremely large review counts
   * don't completely dominate.
   */

  const reviewScore =
    Math.min(
      100,
      (
        Math.log10(
          Math.max(
            10,
            safeReviews
          )
        ) / 5
      ) * 100
    );


  /*
   * Rating is weighted more heavily.
   */

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

          textQuery: query,

          maxResultCount: 20,

          minRating: MIN_RATING,

          rankPreference:
            "RELEVANCE"

        })

      }
    );


  if (!response.ok) {

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
  apiKey
) {

  const cityMap =
    new Map();


  /*
   * Run all discovery searches.
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


  // =======================================================
  // PROCESS RESULTS
  // =======================================================

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

      const rating =
        Number(
          place.rating
        ) || 0;


      const reviewCount =
        Number(
          place.userRatingCount
        ) || 0;


      // -----------------------------------------------
      // RATING FILTER
      // -----------------------------------------------

      if (
        rating <
        MIN_RATING
      ) {

        continue;

      }


      // -----------------------------------------------
      // REVIEW FILTER
      // -----------------------------------------------

      if (
        reviewCount <
        MIN_REVIEWS
      ) {

        continue;

      }


      const address =
        place.formattedAddress ||
        "";


      const city =
        extractCity(
          address
        );


      const country =
        extractCountry(
          address
        );


      if (!city) {
        continue;
      }


      const cityKey =
        `${normalize(city)}|${normalize(country)}`;


      const placeScore =
        calculatePlaceScore(
          rating,
          reviewCount
        );


      // =================================================
      // NEW CITY
      // =================================================

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

            score:
              placeScore,

            rating,

            reviewCount,

            placeCount: 1,

            photo:
              place.photos?.[0]
                ?.name ||
              null,

            photoAttributions:
              place.photos?.[0]
                ?.authorAttributions ||
              [],

            placeId:
              place.id ||
              null,

            googleMapsUrl:
              place.googleMapsUri ||
              null,

            representativePlace:
              place.displayName
                ?.text ||
              ""

          }

        );


        continue;

      }


      // =================================================
      // EXISTING CITY
      // =================================================

      const existing =
        cityMap.get(
          cityKey
        );


      existing.placeCount += 1;


      existing.score +=
        placeScore * 0.25;


      existing.reviewCount +=
        reviewCount;


      /*
       * Keep the strongest-rated
       * representative place.
       */

      const currentScore =
        calculatePlaceScore(
          existing.rating,
          existing.reviewCount
        );


      if (
        placeScore >
        currentScore
      ) {

        existing.rating =
          rating;

        existing.photo =
          place.photos?.[0]
            ?.name ||
          existing.photo;

        existing.photoAttributions =
          place.photos?.[0]
            ?.authorAttributions ||
          existing.photoAttributions;

        existing.placeId =
          place.id ||
          existing.placeId;

        existing.googleMapsUrl =
          place.googleMapsUri ||
          existing.googleMapsUrl;

        existing.representativePlace =
          place.displayName
            ?.text ||
          existing.representativePlace;

      }

    }

  }


  // =======================================================
  // SORT
  // =======================================================

  const cities =
    Array.from(
      cityMap.values()
    );


  cities.sort(
    (a, b) => {

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


  // =======================================================
  // TOP 50
  // =======================================================

  return cities
    .slice(
      0,
      DEFAULT_LIMIT
    )
    .map(
      (city, index) => ({

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

        highlyRatedPlaces:
          city.placeCount,

        score:
          Number(
            city.score.toFixed(2)
          ),

        placeId:
          city.placeId,

        representativePlace:
          city.representativePlace,

        googleMapsUrl:
          city.googleMapsUrl,

        photoName:
          city.photo,

        photoAttributions:
          city.photoAttributions

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
   * Security check.
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
        redirect: "follow"
      }
    );


  if (!response.ok) {

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
    req.method === "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  // =======================================================
  // GET ONLY
  // =======================================================

  if (
    req.method !== "GET"
  ) {

    return res
      .status(405)
      .json({

        success: false,

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

        success: false,

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


    } catch (error) {

      console.error(
        "Photo error:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          error:
            "Unable to retrieve photo."

        });

    }

  }


  // =======================================================
  // TOP CITIES REQUEST
  // =======================================================

  const now =
    Date.now();


  // =======================================================
  // RETURN CACHE
  // =======================================================

  if (
    citiesCache &&
    citiesCacheExpires > now
  ) {

    return res
      .status(200)
      .json({

        success: true,

        cached: true,

        count:
          citiesCache.length,

        cities:
          citiesCache

      });

  }


  // =======================================================
  // BUILD RANKING
  // =======================================================

  try {

    const cities =
      await buildTopCities(
        apiKey
      );


    // =====================================================
    // SAVE CACHE
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

        success: true,

        cached: false,

        generatedAt:
          new Date().toISOString(),

        count:
          cities.length,

        cities

      });


  } catch (error) {

    console.error(
      "Top cities error:",
      error
    );


    return res
      .status(500)
      .json({

        success: false,

        error:
          "Unable to retrieve top cities.",

        message:
          error.message

      });

  }

}
