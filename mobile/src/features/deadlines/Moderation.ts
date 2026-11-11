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

/**
 * Deleting it for everyone: the poster, or an admin (`withdraw_deadline`, phase 55). The
 * server has the last word; once phase 44 asks admins for two-step sign-in, an admin's app
 * session is refused and the error says so.
 */
export function canDelete(moderation: Moderation, isMine: boolean): boolean {
  return isMine || moderation.canEditAny;
}
