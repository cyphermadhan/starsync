declare module 'astronomia/julian' {
  export function DateToJD(date: Date): number;
}

declare module 'astronomia/moonposition' {
  export function position(jde: number): { lon: number; lat: number; range: number };
}
