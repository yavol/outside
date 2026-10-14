export type DestinationId = "cowells" | "main-beach" | "sunset";

export type Destination = {
  id: DestinationId;
  name: string;
  shortName: string;
  area: string;
  description: string;
  coordinates: [number, number];
  tags: string[];
  camera: {
    imageUrl: string;
    sourceUrl: string;
    direction: string;
    cadenceMinutes: number;
    publicationDelayMinutes: number;
  };
  visitUrl: string;
  accessNote: string;
};

const CITY_BEACHES =
  "https://www.santacruzca.gov/Government/City-Departments/Parks-Recreation/Parks-Beaches-Open-Spaces/City-Beaches";
const CAMERA_HOST = "https://cmgp-coastcam.s3-us-west-2.amazonaws.com";

/** Beach pins are approximate destinations, not the camera's physical position. */
export const destinations: Destination[] = [
  {
    id: "cowells",
    name: "Cowell Beach",
    shortName: "Cowell's",
    area: "Santa Cruz",
    description: "A curved pocket of sand beside the wharf, with a coastal walk along West Cliff.",
    coordinates: [-122.0254, 36.9628],
    tags: ["Coastal walk", "Wharf views", "Beach"],
    camera: {
      imageUrl: `${CAMERA_HOST}/cameras/dreaminn/latest/c2_snap.jpg`,
      sourceUrl: "https://www.usgs.gov/media/webcams/santa-cruz-cowells-beach",
      direction: "Looking south from the Dream Inn",
      cadenceMinutes: 30,
      publicationDelayMinutes: 10,
    },
    visitUrl: CITY_BEACHES,
    accessNote: "City beach. Check posted access and ocean conditions on arrival.",
  },
  {
    id: "main-beach",
    name: "Santa Cruz Main Beach",
    shortName: "Main Beach",
    area: "Santa Cruz",
    description: "The broad beach below the Boardwalk, with volleyball courts and a long shoreline stroll.",
    coordinates: [-122.0197, 36.9634],
    tags: ["Boardwalk", "Volleyball", "Beach"],
    camera: {
      imageUrl: `${CAMERA_HOST}/cameras/dreaminn/latest/c1_snap.jpg`,
      sourceUrl: "https://www.usgs.gov/media/webcams/santa-cruz-main-beach-video-camera-1-snapshot",
      direction: "Looking east from the Dream Inn",
      cadenceMinutes: 30,
      publicationDelayMinutes: 10,
    },
    visitUrl: CITY_BEACHES,
    accessNote: "City beach. The city lists beach hours as 7 a.m.–10 p.m.; check current notices.",
  },
  {
    id: "sunset",
    name: "Sunset State Beach",
    shortName: "Sunset Beach",
    area: "Watsonville",
    description: "An open stretch of Monterey Bay backed by dunes, pine trees, and oceanside picnic spots.",
    // California State Parks' official directions pin, rounded for the NWS points API.
    coordinates: [-121.8375, 36.897],
    tags: ["Dunes", "Picnic", "Coastal walk"],
    camera: {
      imageUrl: `${CAMERA_HOST}/cameras/sunset/latest/c2_snap.jpg`,
      sourceUrl: "https://www.usgs.gov/media/webcams/sunset-beach-camera-2-snapshot",
      direction: "Camera 2, looking north",
      cadenceMinutes: 30,
      publicationDelayMinutes: 15,
    },
    visitUrl: "https://www.parks.ca.gov/?page_id=544",
    accessNote: "State park. Stay out of protected dunes; check park notices and day-use access.",
  },
];

export const DESTINATIONS = destinations;

export function isDestinationId(value: unknown): value is DestinationId {
  return typeof value === "string" && destinations.some((place) => place.id === value);
}

export function getDestination(id: DestinationId): Destination {
  return destinations.find((place) => place.id === id)!;
}
