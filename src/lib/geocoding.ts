// Resolves a free-text "place of birth" into the precise UTC birth instant
// that vedic.ts needs to compute the Moon's position accurately. Uses only
// free, keyless services so this doesn't add another account/secret to the
// setup list:
//   - Open-Meteo Geocoding API for place name -> coordinates
//   - tz-lookup (offline, no API calls) for coordinates -> IANA timezone
//   - Intl.DateTimeFormat for that timezone's UTC offset on the birth date
//
// The offset lookup uses the birth date/time interpreted as UTC as an
// approximation of the true instant, purely to select which DST rule
// applies. This is off by the actual offset only in the rare case a
// birth falls within the ~1hr DST transition window itself.

import tzlookup from 'tz-lookup';

export interface Coordinates {
  lat: number;
  lon: number;
}

export async function geocodePlaceOfBirth(place: string): Promise<Coordinates> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`,
  );
  if (!res.ok) {
    throw new Error(`Geocoding lookup failed: ${res.status}`);
  }
  const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
  const result = data.results?.[0];
  if (!result) {
    throw new Error(`Couldn't find "${place}" — try a nearby larger city.`);
  }
  return { lat: result.latitude, lon: result.longitude };
}

export function toUtcDate(dob: string, tob: string, coords: Coordinates): Date {
  return new Date(toIsoWithOffset(dob, tob, coords));
}

export function toIsoWithOffset(dob: string, tob: string, coords: Coordinates): string {
  const timeZone = tzlookup(coords.lat, coords.lon);
  const [year, month, day] = dob.split('-').map(Number);
  const [hour, minute] = tob.split(':').map(Number);
  const approxInstant = new Date(Date.UTC(year, month - 1, day, hour, minute));

  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(approxInstant)
    .find((p) => p.type === 'timeZoneName')?.value;

  const offset = offsetPart?.replace('GMT', '') || '+00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offset}`;
}
