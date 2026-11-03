import { AppRole, Roles } from '../../core/identity';

/**
 * What this person may do to deadlines beyond a student's share. Mirrors the server, which
 * is what actually decides: `verify_deadline` takes a trusted person or an admin, and
 * `edit_deadline` takes the poster or an admin.
 */
export interface Moderation {
  /** Confirm a deadline for everyone — "Confirmed by a moderator". */
  canVerify: boolean;
  /** Edit someone else's deadline, not only their own. */
  canEditAny: boolean;
}

export function moderationFor(role: AppRole): Moderation {
  return { canVerify: Roles.canDecide(role), canEditAny: Roles.canAdminister(role) };
}

/** The whole deadline, not just its details. */
export function canEdit(moderation: Moderation, isMine: boolean): boolean {
  return isMine || moderation.canEditAny;
}
