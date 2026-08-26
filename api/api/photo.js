/**
 * BOKKARA GOOGLE PLACE PHOTO PROXY
 *
 * GET:
 *
 * /api/photo?name=places/PLACE_ID/photos/PHOTO_ID
 *
 * This keeps the Google API key on the backend.
 */

export default async function handler(
  req,
  res
) {

  // =====================================================
  // CORS
  // =====================================================

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  // =====================================================
  // METHOD
  // =====================================================

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


  // =====================================================
  // API KEY
  // =====================================================

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


  // =====================================================
  // PHOTO NAME
  // =====================================================

  const photoName =
    req.query?.name;


  if (
    !photoName ||
    typeof photoName !== "string"
  ) {

    return res
      .status(400)
      .json({

        success: false,

        error:
          "Missing photo name."

      });

  }


  // =====================================================
  // SECURITY
  // =====================================================
  //
  // Only allow Google Places photo resource names.
  //
  // =====================================================

  if (
    !photoName.startsWith(
      "places/"
    ) ||
    !photoName.includes(
      "/photos/"
    )
  ) {

    return res
      .status(400)
      .json({

        success: false,

        error:
          "Invalid Google photo resource."

      });

  }


  // =====================================================
  // GOOGLE PHOTO URL
  // =====================================================

  const googleUrl =
    `https://places.googleapis.com/v1/${photoName}/media` +
    `?maxWidthPx=1000` +
    `&maxHeightPx=1000` +
    `&key=${encodeURIComponent(apiKey)}`;


  try {

    const response =
      await fetch(
        googleUrl,
        {
          redirect: "follow"
        }
      );


    if (!response.ok) {

      const errorText =
        await response.text();


      console.error(
        "Google photo error:",
        response.status,
        errorText
      );


      return res
        .status(
          response.status
        )
        .json({

          success: false,

          error:
            "Unable to retrieve Google photo."

        });

    }


    const contentType =
      response.headers.get(
        "content-type"
      ) ||
      "image/jpeg";


    const imageBuffer =
      Buffer.from(
        await response.arrayBuffer()
      );


    res.setHeader(
      "Content-Type",
      contentType
    );


    /*
     * Short browser cache only.
     *
     * We deliberately don't create a long-term
     * server-side cache of Google's photo resource.
     */

    res.setHeader(
      "Cache-Control",
      "public, max-age=3600"
    );


    return res
      .status(200)
      .send(imageBuffer);


  } catch (error) {

    console.error(
      "Photo proxy error:",
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
