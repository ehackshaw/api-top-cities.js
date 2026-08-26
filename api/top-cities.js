/**
 * BOKKARA TOP CITIES API
 *
 * GET:
 *   /api/top-cities
 *
 * Optional:
 *   /api/top-cities?limit=50
 *   /api/top-cities?minRating=4.5
 *
 * Returns:
 *   Top destination cities based on highly-rated
 *   Google Places results.
 *
 * Google API key:
 *   GOOGLE_PLACES_API_KEY
 *
 * IMPORTANT:
 * Google Places rates individual places, not cities.
 * We therefore aggregate highly-rated destination
 * places into cities and calculate a city score.
 */

const GOOGLE_API_URL =
  "https://places.googleapis.com/v1/places:searchText";


// =====================================================
// CONFIGURATION
// =====================================================

const DEFAULT_LIMIT = 50;

const DEFAULT_MIN_RATING = 4.5;

const DEFAULT_MIN_REVIEWS = 100;

const MAX_SEARCHES = 20;


// =====================================================
// WORLDWIDE SEARCH QUERIES
// =====================================================
//
// These are NOT a list of cities.
//
// They are broad discovery queries used to find
// destination places around the world.
//
// Google then supplies the actual places/cities.
//
// =====================================================

const SEARCH_QUERIES = [

  // North America
  "top tourist attractions in North America",
  "best tourist attractions in United States",
  "best tourist attractions in Canada",
  "best tourist attractions in Mexico",
  "best tourist attractions in Caribbean",

  // South America
  "top tourist attractions in South America",
  "best tourist attractions in Brazil",
  "best tourist attractions in Argentina",
  "best tourist attractions in Colombia",
  "best tourist attractions in Peru",
  "best tourist attractions in Chile",

  // Europe
  "top tourist attractions in Europe",
  "best tourist attractions in United Kingdom",
  "best tourist attractions in France",
  "best tourist attractions in Italy",
  "best tourist attractions in Spain",
  "best tourist attractions in Germany",
  "best tourist attractions in Greece",
  "best tourist attractions in Portugal",

  // Asia
  "top tourist attractions in Asia",
  "best tourist attractions in Japan",
  "best tourist attractions in Thailand",
  "best tourist attractions in Singapore",
  "best tourist attractions in Indonesia",
  "best tourist attractions in South Korea",
  "best tourist attractions in United Arab Emirates",

  // Oceania
  "top tourist attractions in Australia",
  "top tourist attractions in New Zealand",

  // Africa
  "top tourist attractions in Africa",
  "best tourist attractions in South Africa",
  "best tourist attractions in Egypt",
  "best tourist attractions in Morocco"
];


// =====================================================
// GOOGLE FIELD MASK
// =====================================================

const FIELD_MASK = [

  "places.id",
  "places.name",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
  "places.googleMapsUri",
  "places.types"

].join(",");


// =====================================================
// SIMPLE IN-MEMORY CACHE
// =====================================================
//
// This protects the API from being called repeatedly
// during the lifetime of the Vercel instance.
//
// Later we can move this to Vercel KV / Redis if needed.
//
// =====================================================

let cache = {
  data: null,
  expiresAt: 0
};


// =====================================================
// CACHE TIME
// =====================================================

const CACHE_DURATION = 1000 * 60 * 60 * 6;


// =====================================================
// NORMALIZE CITY NAME
// =====================================================

function normalizeCityName(name) {

  if (!name) {
    return "";
  }

  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

}


// =====================================================
// EXTRACT CITY FROM GOOGLE ADDRESS
// =====================================================

function extractCity(place) {

  const address =
    place.formattedAddress || "";

  if (!address) {
    return place.displayName?.text || "";
  }


  const parts = address
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);


  if (parts.length === 0) {
    return place.displayName?.text || "";
  }


  /*
   * Google addresses vary worldwide.
   *
   * In many cases:
   *
   * Attraction, City, State, Country
   *
   * or:
   *
   * Attraction, City, Country
   *
   * We use the second-to-last component as the
   * city candidate.
   */

  if (parts.length >= 3) {
    return parts[parts.length - 2];
  }


  if (parts.length === 2) {
    return parts[0];
  }


  return place.displayName?.text || "";

}


// =====================================================
// EXTRACT COUNTRY
// =====================================================

function extractCountry(place) {

  const address =
    place.formattedAddress || "";

  const parts = address
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);


  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }


  return "";

}


// =====================================================
// FETCH GOOGLE PLACES
// =====================================================

async function searchGooglePlaces(
  query,
  apiKey
) {

  const response = await fetch(
    GOOGLE_API_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK
      },

      body: JSON.stringify({

        textQuery: query,

        maxResultCount: 20,

        minRating: DEFAULT_MIN_RATING,

        rankPreference: "RELEVANCE"

      })

    }
  );


  if (!response.ok) {

    const errorText =
      await response.text();

    throw new Error(
      `Google Places error ${response.status}: ${errorText}`
    );

  }


  return response.json();

}


// =====================================================
// CITY SCORE
// =====================================================
//
// We don't simply rank by rating.
//
// A 5.0 rating with 20 reviews should not automatically
// beat a 4.8 rating with 30,000 reviews.
//
// This scoring system balances:
//
//   - Google rating
//   - number of ratings
//   - number of strong places in the city
//
// =====================================================

function calculatePlaceScore(
  rating,
  reviewCount
) {

  const safeRating =
    Number(rating) || 0;

  const safeReviews =
    Number(reviewCount) || 0;


  /*
   * Rating component
   *
   * 4.5 → 0
   * 5.0 → 100
   */

  const ratingScore =
    Math.max(
      0,
      Math.min(
        100,
        ((safeRating - 4.5) / 0.5) * 100
      )
    );


  /*
   * Review component.
   *
   * Logarithmic so 100,000 reviews doesn't
   * completely dominate everything.
   */

  const reviewScore =
    Math.min(
      100,
      (Math.log10(
        Math.max(10, safeReviews)
      ) / 5) * 100
    );


  return (
    ratingScore * 0.70 +
    reviewScore * 0.30
  );

}


// =====================================================
// BUILD CITY DATABASE
// =====================================================

async function buildCities(apiKey) {

  const cityMap = new Map();


  /*
   * Run searches in parallel, but limit the number
   * to prevent excessive Google API usage.
   */

  const queries =
    SEARCH_QUERIES.slice(
      0,
      MAX_SEARCHES
    );


  const results =
    await Promise.allSettled(

      queries.map(query =>
        searchGooglePlaces(
          query,
          apiKey
        )
      )

    );


  // ===================================================
  // PROCESS GOOGLE RESULTS
  // ===================================================

  for (const result of results) {

    if (result.status !== "fulfilled") {
      continue;
    }


    const places =
      result.value?.places || [];


    for (const place of places) {

      const rating =
        Number(place.rating) || 0;

      const reviewCount =
        Number(place.userRatingCount) || 0;


      /*
       * Require the minimum quality threshold.
       */

      if (
        rating < DEFAULT_MIN_RATING
      ) {
        continue;
      }


      if (
        reviewCount < DEFAULT_MIN_REVIEWS
      ) {
        continue;
      }


      const city =
        extractCity(place);


      const country =
        extractCountry(place);


      if (!city) {
        continue;
      }


      /*
       * Don't allow obvious non-city names.
       */

      const normalizedCity =
        normalizeCityName(city);


      if (!normalizedCity) {
        continue;
      }


      /*
       * Build a country-aware key.
       */

      const cityKey =
        `${normalizedCity}|${normalizeCityName(country)}`;


      const placeScore =
        calculatePlaceScore(
          rating,
          reviewCount
        );


      const existing =
        cityMap.get(cityKey);


      // =================================================
      // ADD NEW CITY
      // =================================================

      if (!existing) {

        cityMap.set(

          cityKey,

          {

            city,

            country,

            score: placeScore,

            bestRating: rating,

            totalReviews: reviewCount,

            placeCount: 1,

            bestPlace: {

              id: place.id || null,

              name:
                place.displayName?.text ||
                "",

              rating,

              reviewCount,

              photoName:
                place.photos?.[0]?.name ||
                null,

              photoAttributions:
                place.photos?.[0]
                  ?.authorAttributions ||
                [],

              googleMapsUri:
                place.googleMapsUri ||
                null

            }

          }

        );


        continue;

      }


      // =================================================
      // ADD ANOTHER STRONG PLACE TO EXISTING CITY
      // =================================================

      existing.placeCount += 1;


      existing.totalReviews +=
        reviewCount;


      existing.score +=
        placeScore * 0.25;


      if (
        rating >
        existing.bestRating
      ) {

        existing.bestRating =
          rating;

      }


      /*
       * Use the place with the highest combined
       * rating/review score as the representative
       * Google place for the city.
       */

      const currentBestScore =
        calculatePlaceScore(
          existing.bestPlace.rating,
          existing.bestPlace.reviewCount
        );


      if (
        placeScore >
        currentBestScore
      ) {

        existing.bestPlace = {

          id: place.id || null,

          name:
            place.displayName?.text ||
            "",

          rating,

          reviewCount,

          photoName:
            place.photos?.[0]?.name ||
            null,

          photoAttributions:
            place.photos?.[0]
              ?.authorAttributions ||
            [],

          googleMapsUri:
            place.googleMapsUri ||
            null

        };

      }

    }

  }


  // ===================================================
  // CONVERT MAP TO ARRAY
  // ===================================================

  const cities =
    Array.from(
      cityMap.values()
    );


  // ===================================================
  // FINAL RANKING
  // ===================================================

  cities.sort(
    (a, b) => {

      if (
        b.score !== a.score
      ) {

        return b.score - a.score;

      }


      if (
        b.bestRating !==
        a.bestRating
      ) {

        return (
          b.bestRating -
          a.bestRating
        );

      }


      return (
        b.totalReviews -
        a.totalReviews
      );

    }
  );


  // ===================================================
  // RETURN TOP 50
  // ===================================================

  return cities
    .slice(0, DEFAULT_LIMIT)
    .map(
      (city, index) => ({

        rank: index + 1,

        city:
          city.city,

        country:
          city.country,

        rating:
          Number(
            city.bestRating.toFixed(1)
          ),

        reviewCount:
          city.totalReviews,

        placeCount:
          city.placeCount,

        score:
          Number(
            city.score.toFixed(2)
          ),

        placeId:
          city.bestPlace.id,

        representativePlace:
          city.bestPlace.name,

        googleMapsUrl:
          city.bestPlace.googleMapsUri,

        /*
         * We intentionally return the Google photo
         * resource name separately.
         *
         * The Shopify frontend will later use
         * /api/photo to retrieve the actual image.
         */

        photoName:
          city.bestPlace.photoName,

        photoAttributions:
          city.bestPlace.photoAttributions

      })
    );

}


// =====================================================
// API HANDLER
// =====================================================

export default async function handler(
  req,
  res
) {

  // ===================================================
  // CORS
  // ===================================================

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


  // ===================================================
  // OPTIONS
  // ===================================================

  if (
    req.method === "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  // ===================================================
  // ONLY GET
  // ===================================================

  if (
    req.method !== "GET"
  ) {

    return res
      .status(405)
      .json({

        success: false,

        error:
          "Method not allowed"

      });

  }


  // ===================================================
  // API KEY
  // ===================================================

  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY;


  if (!apiKey) {

    return res
      .status(500)
      .json({

        success: false,

        error:
          "GOOGLE_PLACES_API_KEY is not configured."

      });

  }


  // ===================================================
  // CACHE
  // ===================================================

  const now =
    Date.now();


  if (
    cache.data &&
    cache.expiresAt > now
  ) {

    return res
      .status(200)
      .json({

        success: true,

        cached: true,

        generatedAt:
          cache.data.generatedAt,

        count:
          cache.data.cities.length,

        cities:
          cache.data.cities

      });

  }


  // ===================================================
  // BUILD TOP 50
  // ===================================================

  try {

    const cities =
      await buildCities(
        apiKey
      );


    const data = {

      generatedAt:
        new Date().toISOString(),

      cities

    };


    // =================================================
    // SAVE CACHE
    // =================================================

    cache = {

      data,

      expiresAt:
        now +
        CACHE_DURATION

    };


    // =================================================
    // RESPONSE
    // =================================================

    return res
      .status(200)
      .json({

        success: true,

        cached: false,

        generatedAt:
          data.generatedAt,

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
          "Unable to build top cities.",

        message:
          error.message

      });

  }

}
