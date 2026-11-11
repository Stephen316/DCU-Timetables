import { canDelete, canEdit, moderationFor } from '../src/features/deadlines/Moderation';
import { deadlineRefusal } from '../src/data/stores';

describe('who may change a deadline', () => {
  test('a poster edits and deletes their own', () => {
    const student = moderationFor('student');
    expect(canEdit(student, true)).toBe(true);
    expect(canDelete(student, true)).toBe(true);
  });

  test('a student or trusted classmate cannot delete someone else’s', () => {
    expect(canDelete(moderationFor('student'), false)).toBe(false);
    expect(canDelete(moderationFor('trusted'), false)).toBe(false);
  });

  test('an admin edits and deletes anyone’s (phase 55)', () => {
    const admin = moderationFor('admin');
    expect(canEdit(admin, false)).toBe(true);
    expect(canDelete(admin, false)).toBe(true);
  });
});

describe('deadlineRefusal', () => {
  const body = (message: string, code = 'P0001') => JSON.stringify({ code, message, details: null, hint: null });

  test('says the database’s reason as a sentence', () => {
    expect(deadlineRefusal(body('the due date has passed'))).toBe('The due date has passed.');
    expect(deadlineRefusal(body('details can be at most 100 characters'))).toBe('Details can be at most 100 characters.');
  });

  test('rewords the terse ones', () => {
    expect(deadlineRefusal(body('not allowed'))).toBe("You can't change that deadline.");
    expect(deadlineRefusal(body('no such deadline of yours'))).toBe("That deadline has gone, or isn't yours to delete.");
  });

  test('keeps internals out: other codes, missing functions and non-JSON give null', () => {
    expect(deadlineRefusal(body('Could not find the function public.withdraw_deadline', 'PGRST202'))).toBeNull();
    expect(deadlineRefusal(body('duplicate key value violates unique constraint', '23505'))).toBeNull();
    expect(deadlineRefusal('<html>Bad gateway</html>')).toBeNull();
    expect(deadlineRefusal('')).toBeNull();
  });
});
