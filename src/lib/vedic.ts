// Computes Rasi (Moon sign) and Nakshatra ourselves, in-process — no
// third-party astrology API. This product's content is entertainment/
// affirmation-style, not a claim of professional astrological precision, so
// the accuracy this gives (full Meeus "Astronomical Algorithms" ch. 47 lunar
// theory, good to a few arcseconds, minus an approximate Lahiri ayanamsa) is
// more than sufficient — errors only matter in the rare case a birth instant
// falls within a fraction of a degree of a sign boundary.
//
// We deliberately don't compute the Lagna (ascendant) — traditional daily
// "raasi palan" content is keyed off the Moon's rasi, not the ascendant, so
// there's nothing that needs it.

import * as julian from 'astronomia/julian';
import * as moonposition from 'astronomia/moonposition';

const RASI_NAMES = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrischika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
];

const NAKSHATRA_NAMES = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];

const NAKSHATRA_SPAN = 360 / 27; // 13°20'

function lahiriAyanamsaDeg(utcDate: Date): number {
  // Standard approximation: 23.85° at epoch 2000.0, precessing ~50.29"/year.
  const decimalYear = utcDate.getUTCFullYear() + (utcDate.getUTCMonth() + 1) / 12;
  return 23.85 + (50.29 / 3600) * (decimalYear - 2000);
}

export interface VedicChart {
  rasi: string;
  nakshatra: string;
  pada: number;
}

export function computeVedicChart(birthUtc: Date): VedicChart {
  const jd = julian.DateToJD(birthUtc);
  const tropicalLonDeg = ((moonposition.position(jd).lon * 180) / Math.PI + 360) % 360;
  const siderealLonDeg = (tropicalLonDeg - lahiriAyanamsaDeg(birthUtc) + 360) % 360;

  const rasiIndex = Math.floor(siderealLonDeg / 30);
  const nakshatraIndex = Math.floor(siderealLonDeg / NAKSHATRA_SPAN);
  const pada = Math.floor((siderealLonDeg % NAKSHATRA_SPAN) / (NAKSHATRA_SPAN / 4)) + 1;

  return {
    rasi: RASI_NAMES[rasiIndex],
    nakshatra: NAKSHATRA_NAMES[nakshatraIndex],
    pada,
  };
}
