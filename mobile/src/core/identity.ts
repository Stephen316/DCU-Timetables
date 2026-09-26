import { isLetter } from './activityCode';

// MARK: - Roles

/**
 * What a signed-in account is allowed to do. Mirrors the `app_role` enum in
 * `supabase/phase0_identity.sql`.
 *
 * A *hint for the UI only*: every permission is enforced by row-level security in the
 * database, because a role cached on a device is a role a determined person can edit.
 */
export type AppRole = 'student' | 'trusted' | 'admin';

/** An unknown role from the server reads as student, never as more. */
export function parseRole(raw: unknown): AppRole | null {
  return raw === 'student' || raw === 'trusted' || raw === 'admin' ? raw : null;
}

export const Roles = {
  /** May post definitive verdicts and verify deadlines. */
  canDecide: (role: AppRole) => role === 'trusted' || role === 'admin',
  /** May grant trust, ban, and import in bulk. */
  canAdminister: (role: AppRole) => role === 'admin',
  label(role: AppRole): string {
    switch (role) {
      case 'student': return 'Student';
      case 'trusted': return 'Trusted';
      case 'admin': return 'Admin';
    }
  },
};

/** The signed-in account's row in `profiles`. */
export interface AccountProfile {
  id: string;
  role: AppRole;
  /** The shareable identifier. Null until one has been allocated. */
  pi: string | null;
  displayName: string | null;
  bannedUntil: Date | null;
  /** "A12345678", once the student has given it. Only an admin can change it after. */
  studentID: string | null;
}

export function makeAccountProfile(id: string, fields: Partial<Omit<AccountProfile, 'id'>> = {}): AccountProfile {
  return {
    id,
    role: fields.role ?? 'student',
    pi: fields.pi ?? null,
    displayName: fields.displayName ?? null,
    bannedUntil: fields.bannedUntil ?? null,
    studentID: fields.studentID ?? null,
  };
}

export const AccountRules = {
  isBanned(profile: AccountProfile, now: Date = new Date()): boolean {
    return profile.bannedUntil !== null && profile.bannedUntil.getTime() > now.getTime();
  },
  /**
   * A banned account keeps its role in the database but must not act on it, so the two
   * checks are never asked separately at a call site.
   */
  canDecide(profile: AccountProfile, now: Date = new Date()): boolean {
    return Roles.canDecide(profile.role) && !AccountRules.isBanned(profile, now);
  },
  canAdminister(profile: AccountProfile, now: Date = new Date()): boolean {
    return Roles.canAdminister(profile.role) && !AccountRules.isBanned(profile, now);
  },
};

const isASCIIDigit = (ch: string) => ch >= '0' && ch <= '9';
const isASCIILetter = (ch: string) => /^[A-Za-z]$/.test(ch);

/** The identifier a student shares to be made trusted: one letter and six digits. */
export const PublicIdentifier = {
  /**
   * I and O are absent on purpose: read aloud or retyped they are 1 and 0. Must match the
   * alphabet in `public.new_pi()`.
   */
  letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ',

  /** Uppercases and strips spaces and hyphens. Null when what's left isn't one. */
  normalised(raw: string): string | null {
    const stripped = Array.from(raw.toUpperCase())
      .filter((ch) => !' -–—_'.includes(ch))
      .join('');
    return PublicIdentifier.isValid(stripped) ? stripped : null;
  },

  isValid(candidate: string): boolean {
    const chars = Array.from(candidate);
    if (chars.length !== 7) return false;
    return PublicIdentifier.letters.includes(chars[0]) && chars.slice(1).every(isASCIIDigit);
  },
};

// MARK: - DCU email

/**
 * A validated DCU address, and the student's name derived from it. Only `@dcu.ie` and
 * `@mail.dcu.ie` are accepted — the whole point is that a confirmed DCU address proves the
 * person is a student, so any other domain or a lookalike must be rejected.
 *
 * The local part carries the name: `stephen.harcourt2` → Stephen Harcourt.
 */
export interface DCUEmail {
  address: string;
  /** Lowercased name parts in email order, e.g. ["stephen", "harcourt"]. */
  nameParts: string[];
  givenName: string;
  familyName: string;
  /** "Stephen Harcourt" */
  displayName: string;
}

export const ALLOWED_DOMAINS = ['dcu.ie', 'mail.dcu.ie'];

const titleCased = (part: string) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1));
const isDigitLike = (ch: string) => NUMBER.test(ch);

export function parseDCUEmail(raw: string): DCUEmail | null {
  const trimmed = raw.trim().toLowerCase();
  const pieces = trimmed.split('@');
  if (pieces.length !== 2) return null;
  const [local, domain] = pieces;
  if (local.length === 0 || !ALLOWED_DOMAINS.includes(domain)) return null;

  // Dots separate names; a trailing number disambiguates duplicates and isn't part of the
  // name. Anything left without letters is not a name part.
  const parts = local
    .split('.')
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      let chars = Array.from(piece);
      while (chars.length > 0 && !isLetter(chars[0])) chars = chars.slice(1);
      while (chars.length > 0 && isDigitLike(chars[chars.length - 1])) chars = chars.slice(0, -1);
      return chars.join('');
    })
    .filter((part) => part.length > 0 && Array.from(part).some(isLetter));
  if (parts.length === 0) return null;

  return {
    address: trimmed,
    nameParts: parts,
    givenName: titleCased(parts[0]),
    familyName: parts.length > 1 ? titleCased(parts[parts.length - 1]) : '',
    displayName: parts.map(titleCased).join(' '),
  };
}

// MARK: - Student number

/**
 * A DCU student number — a letter and eight digits, "A12345678" — in the form
 * `profiles.student_id` stores it.
 */
export const StudentNumber = {
  /**
   * Read from the Code 39 barcode on a student card: "10", the eight digits of the number,
   * then three more (A12345678's card reads 1012345678001). The barcode has no check
   * character, so anything that isn't exactly this shape is refused rather than trimmed
   * into a plausible-looking number.
   */
  fromBarcode(barcode: string): string | null {
    const code = barcode.trim();
    if (code.length !== 13 || !code.startsWith('10') || !Array.from(code).every(isASCIIDigit)) return null;
    return 'A' + code.slice(2, 10);
  },

  /**
   * Typed by hand. Case, spaces and hyphens don't matter, a missing leading letter is taken
   * to be "A", and the 13-digit number printed under the barcode is accepted too.
   */
  fromTyped(typed: string): string | null {
    const entry = Array.from(typed.toUpperCase())
      .filter((ch) => !/\s/.test(ch) && ch !== '-')
      .join('');
    const read = StudentNumber.fromBarcode(entry);
    if (read !== null) return read;
    const chars = Array.from(entry);
    const letter = chars.length > 0 && isASCIILetter(chars[0]) ? chars[0] : null;
    const digits = letter === null ? chars : chars.slice(1);
    if (digits.length !== 8 || !digits.every(isASCIIDigit)) return null;
    return (letter ?? 'A') + digits.join('');
  },
};

// MARK: - Passwords

/**
 * Lenient on purpose: a password is typed by the person who chose it, so the digits their
 * keyboard produces count. Engines without Unicode property escapes fall back to ASCII.
 */
const NUMBER: RegExp = (() => {
  try {
    return new RegExp('^\\p{N}$', 'u');
  } catch {
    return /^[0-9]$/;
  }
})();

export type PasswordProblem = 'tooShort' | 'needsCapital' | 'needsLowercase' | 'needsNumber' | 'mismatch';

export const PasswordValidation = {
  minimumLength: 8,

  /** The rules in one line, for the form to show before anything has been typed. */
  requirements: 'At least 8 characters, with a capital, a lower-case letter and a number',

  message(problem: PasswordProblem): string {
    switch (problem) {
      case 'tooShort': return `Use at least ${PasswordValidation.minimumLength} characters`;
      case 'needsCapital': return 'Add a capital letter';
      case 'needsLowercase': return 'Add a lower-case letter';
      case 'needsNumber': return 'Add a number';
      case 'mismatch': return "Passwords don't match";
    }
  },

  /**
   * What to tell the student right now, one problem at a time: a mismatch first (one box
   * has a typo), then length, then the character rules. Nothing until they've typed.
   */
  problem(password: string, confirmation: string): PasswordProblem | null {
    if (confirmation.length > 0 && password !== confirmation) return 'mismatch';
    if (password.length === 0) return null;
    return compositionProblem(password);
  },

  canCreateAccount(password: string, confirmation: string): boolean {
    return password === confirmation && compositionProblem(password) === null;
  },
};

function compositionProblem(password: string): PasswordProblem | null {
  const chars = Array.from(password);
  if (chars.length < PasswordValidation.minimumLength) return 'tooShort';
  if (!chars.some((ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase())) return 'needsCapital';
  if (!chars.some((ch) => ch !== ch.toUpperCase() && ch === ch.toLowerCase())) return 'needsLowercase';
  if (!chars.some(isDigitLike)) return 'needsNumber';
  return null;
}
