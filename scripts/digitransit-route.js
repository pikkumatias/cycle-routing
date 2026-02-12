import dotenv from "dotenv";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Load environment variables from .env and .env.local (local overrides)
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

// Use the HSL router as the primary region router
const DIGITRANSIT_ENDPOINT =
  "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";

function parseLatLon(inputStr) {
  const cleaned = inputStr.trim();
  if (!cleaned) {
    throw new Error("Empty coordinate input.");
  }

  const parts = cleaned.includes(",")
    ? cleaned.split(",")
    : cleaned.split(/\s+/);

  if (parts.length !== 2) {
    throw new Error(
      'Invalid coordinate format. Use "lat,lon" or "lat lon", for example: 60.192059,24.945831',
    );
  }

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error("Latitude and longitude must be numbers.");
  }

  return { lat, lon };
}

async function promptCoordinates() {
  const rl = readline.createInterface({ input, output });

  try {
    const fromInput = await rl.question(
      'From (lat,lon), e.g. "60.192059,24.945831": ',
    );
    const toInput = await rl.question(
      'To (lat,lon), e.g. "60.169857,24.938379": ',
    );

    return {
      from: parseLatLon(fromInput),
      to: parseLatLon(toInput),
    };
  } finally {
    rl.close();
  }
}

async function fetchRoute({ from, to }) {
  const subscriptionKey = process.env.DIGITRANSIT_API_KEY;

  if (!subscriptionKey) {
    console.error(
      "DIGITRANSIT_API_KEY environment variable is not set. Please set it to your Digitransit API key.",
    );
    process.exit(1);
  }

  const query = `
    query PlanBicycleRoute(
      $fromLat: Float!
      $fromLon: Float!
      $toLat: Float!
      $toLon: Float!
    ) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to: { lat: $toLat, lon: $toLon }
        numItineraries: 1
        transportModes: [{ mode: BICYCLE }]
      ) {
        itineraries {
          duration
          walkDistance
          legs {
            mode
            startTime
            endTime
            distance
            from { name }
            to { name }
            route {
              shortName
              longName
            }
          }
        }
      }
    }
  `;

  const body = JSON.stringify({
    query,
    variables: {
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
    },
  });

  const response = await fetch(DIGITRANSIT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "digitransit-subscription-key": subscriptionKey,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Routing API error: ${response.status} ${response.statusText}\n${text}`,
    );
  }

  const data = await response.json();

  if (
    process.env.DEBUG_DIGITRANSIT === "1" ||
    (process.env.DEBUG_DIGITRANSIT ?? "").toLowerCase() === "true"
  ) {
    console.log("\nRaw Digitransit response:");
    console.dir(data, { depth: null, colors: true });
  }

  if (data.errors) {
    console.error("GraphQL errors:", JSON.stringify(data.errors, null, 2));
    process.exit(1);
  }

  return data.data.plan;
}

function printItinerary(plan) {
  if (!plan || !plan.itineraries || plan.itineraries.length === 0) {
    console.log("No itineraries found for the given points.");
    return;
  }

  const itinerary = plan.itineraries[0];
  console.log(
    `Total duration: ${Math.round(itinerary.duration / 60)} minutes, walk distance: ${Math.round(itinerary.walkDistance)} meters`,
  );

  console.log("\nLegs:");
  for (const leg of itinerary.legs) {
    const start = new Date(leg.startTime);
    const end = new Date(leg.endTime);
    const routeName =
      leg.route?.shortName || leg.route?.longName || leg.mode || "Leg";

    console.log(
      `- ${routeName}: ${leg.from.name} -> ${leg.to.name} (${leg.mode}), ${Math.round(leg.distance)} m, ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`,
    );
  }
}

async function main() {
  try {
    const coords = await promptCoordinates();
    const plan = await fetchRoute(coords);
    printItinerary(plan);
  } catch (error) {
    console.error("Failed to fetch route:", error);
    process.exit(1);
  }
}

main();

