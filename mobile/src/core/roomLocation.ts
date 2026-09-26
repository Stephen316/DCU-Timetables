import { TimetableEvent } from './timetableEvent';

/** A DCU campus. */
export type Campus = 'glasnevin' | 'stPatricks' | 'allHallows';

function campusFromCode(code: string): Campus | null {
  switch (code.toUpperCase()) {
    case 'GLA': return 'glasnevin';
    case 'SPC':
    case 'SPD': return 'stPatricks';
    case 'AHC': return 'allHallows';
    default: return null;
  }
}

export function campusName(campus: Campus): string {
  switch (campus) {
    case 'glasnevin': return 'Glasnevin';
    case 'stPatricks': return "St Patrick's";
    case 'allHallows': return 'All Hallows';
  }
}

export type Floor =
  | { kind: 'ground' }
  | { kind: 'basement' }
  | { kind: 'mezzanine' }
  | { kind: 'numbered'; number: number };

export function floorLabel(floor: Floor): string {
  switch (floor.kind) {
    case 'ground': return 'Ground floor';
    case 'basement': return 'Basement';
    case 'mezzanine': return 'Mezzanine';
    case 'numbered': return `Floor ${floor.number}`;
  }
}

// Glasnevin building codes (DCU campus guide). Longer codes must be matched first.
const GLASNEVIN_BUILDINGS: Record<string, string> = {
  A: 'Albert College', B: 'Invent', C: 'Henry Grattan',
  CA: 'Henry Grattan Extension', D: 'BEA Orpen', E: 'Estates Office',
  F: 'Multi-storey Car Park', FT: 'Polaris', G: 'NICB',
  GA: 'Nano Research Facility', H: 'Nursing Building', J: 'Hamilton',
  KA: 'The U (Student Centre)', L: 'McNulty', M: 'Interfaith Centre',
  N: 'Marconi', P: 'Pavilion', PR: 'Restaurant', Q: 'DCU Business School',
  QA: 'MacCormac', R: 'Créche', S: 'Stokes', SA: 'Stokes Extension',
  T: 'Terence Larkin Theatre', U: 'DCU Sport', X: 'Lonsdale',
  Y: "O'Reilly Library", Z: 'The Helix',
  IFSC: 'DCU Business School', KPMG: 'DCU Business School', SPORTS: 'DCU Sport',
};

// Longest building code first, so CA/SA/FT win over C/S/F.
const KNOWN_CODES = Object.keys(GLASNEVIN_BUILDINGS).sort((a, b) => b.length - a.length);

/**
 * A parsed DCU room code such as `GLA.FT301`.
 *
 * The format is **campus . building + floor + room** — e.g. `GLA.CG86` is Glasnevin,
 * Henry Grattan (C), Ground floor, room 86; `GLA.FT301` is Polaris (FT), floor 3, room 301.
 * Building names are only mapped for Glasnevin; anything unrecognised keeps its raw code
 * rather than inventing a name.
 */
export interface RoomLocation {
  raw: string;
  campus: Campus | null;
  /** The room code with the campus prefix removed, e.g. "FT301". */
  code: string;
  buildingCode: string | null;
  buildingName: string | null;
  floor: Floor | null;
  room: string | null;
}

export function parseRoom(raw: string): RoomLocation {
  const trimmed = raw.replace(/^[ \t]+|[ \t]+$/g, '');

  // Campus prefix before the "." — dropped from the displayed code.
  let body = trimmed;
  let campus: Campus | null = null;
  const dot = trimmed.indexOf('.');
  if (dot >= 0) {
    campus = campusFromCode(trimmed.slice(0, dot));
    body = trimmed.slice(dot + 1);
  }

  // Parse structure from the leading token (handles "XG28 & XG28-A").
  const token = body.split(/[ &]/).find((piece) => piece.length > 0) ?? body;
  const upper = token.toUpperCase();

  const building = KNOWN_CODES.find((code) => upper.startsWith(code)) ?? null;
  const buildingName =
    building !== null && (campus === 'glasnevin' || campus === null)
      ? GLASNEVIN_BUILDINGS[building]
      : null;

  let rest = building !== null ? upper.slice(building.length) : upper;

  // Optional floor letter, then the room digits (first digit is the floor).
  let floor: Floor | null = null;
  switch (rest[0]) {
    case 'G': floor = { kind: 'ground' }; rest = rest.slice(1); break;
    case 'B': floor = { kind: 'basement' }; rest = rest.slice(1); break;
    case 'M': floor = { kind: 'mezzanine' }; rest = rest.slice(1); break;
  }
  const digits = /^[0-9]*/.exec(rest)?.[0] ?? '';
  const room = digits.length === 0 ? null : digits;
  if (floor === null && digits.length > 0) {
    floor = { kind: 'numbered', number: Number(digits[0]) };
  }

  return { raw, campus, code: body, buildingCode: building, buildingName, floor, room };
}

/**
 * "Polaris, Room 301, Floor 3" — the readable location, never the raw room code. Falls
 * back to the code only when the building can't be identified (non-Glasnevin campuses),
 * because there is nothing truthful to show in its place.
 */
export function roomDisplayText(location: RoomLocation): string {
  if (location.buildingName === null) return location.code;
  const parts = [location.buildingName];
  if (location.room !== null) parts.push(`Room ${location.room}`);
  if (location.floor !== null) parts.push(floorLabel(location.floor));
  return parts.join(', ');
}

/** "Polaris, Room 301" — used when one class spans several rooms, to keep the row short. */
export function roomShortText(location: RoomLocation): string {
  if (location.buildingName === null) return location.code;
  if (location.room === null) return location.buildingName;
  return `${location.buildingName}, Room ${location.room}`;
}

export function parsedLocations(event: TimetableEvent): RoomLocation[] {
  return event.locations.map(parseRoom);
}

/** Readable room text: full detail for a single room, name + room for several. */
export function locationDisplay(event: TimetableEvent): string {
  const parsed = parsedLocations(event);
  if (parsed.length === 0) return '—';
  if (parsed.length === 1) return roomDisplayText(parsed[0]);
  return parsed.map(roomShortText).join(' · ');
}
