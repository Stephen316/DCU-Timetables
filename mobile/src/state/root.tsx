import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cohortForCourseKey, decodeProfile, StudentProfile, TimetableAudience } from '../core/profile';
import { localDateString } from '../core/time';
import { categoryCode, TimetableCategory } from '../core/timetableEvent';
import {
  AllocationRefresh, LabRotationRefresh, ModuleSplitRefresh, ModuleTitleRefresh, SubgroupQuestion, TimetableChangeRefresh,
} from '../data/courseData';
import { ModuleAbbreviationRefresh } from '../data/abbreviations';
import { TimetableSource } from '../data/dcuApi';
import { takeAuthLink } from '../data/authLink';
import { errorMessage } from '../data/rest';
import { AuthenticatedUser, userEmail } from '../data/session';
import { PrefKey } from '../data/storage';
import { bundledRotation, ProfileTimetableSource, ROTATION_COURSE_KEY } from '../data/timetable';
import { WeekModel } from '../features/week/WeekModel';
import { useAppEvent, usePref, usePrefJSON, useServices } from './hooks';

/** Which screen the app is on, decided from what the device remembers. */
export type Flow = 'signIn' | 'newPassword' | 'studentID' | 'programmePicker' | 'shell';

/** The signed-in app's timetable: whose it is and where it comes from. */
export interface ShellConfig {
  /** Changes whenever the timetable behind the shell does, so its model is rebuilt. */
  key: string;
  programme: TimetableCategory;
  source: TimetableSource;
  audience: TimetableAudience | null;
  /** Matched to a class list: groups and labs come from it, so there is nothing to choose. */
  groupsAssigned: boolean;
}

interface RootState {
  flow: Flow;
  user: AuthenticatedUser | null;
  shell: ShellConfig | null;
  model: WeekModel | null;
  /** Why an email link went nowhere, for the sign-in screen to explain. */
  notice: string | null;
  signedIn(user: AuthenticatedUser): void;
  signOut(): void;
  /** Leaves the reset screen a recovery link opened, changed password or not. */
  passwordResetDone(): void;
  /**
   * Set when the class list for the picked programme has more than one student with this
   * student's name: the timetable asks which lab subgroup is theirs.
   */
  subgroupQuestion: SubgroupQuestion | null;
  /** Their answer. `noMatch` leaves the question open, to pick again now or on a later launch. */
  answerSubgroup(subgroup: string): Promise<'adopted' | 'noMatch'>;
}

const RootContext = createContext<RootState | null>(null);

export function useRoot(): RootState {
  const root = useContext(RootContext);
  if (!root) throw new Error('useRoot outside RootProvider');
  return root;
}

/** The shell's shared week model. Only valid inside the signed-in screens. */
export function useWeekModel(): WeekModel {
  const { model } = useRoot();
  if (!model) throw new Error('No timetable is open');
  return model;
}

/**
 * Flow: sign in with a DCU address → student number from the card → pick a programme →
 * timetable. Once a programme is picked, the class list for its course is checked in the
 * background; a student on it moves onto their lab group, anyone else stays as they are.
 */
export function RootProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const [user, setUser] = useState<AuthenticatedUser | null>(() => services.user.current);
  const [studentID] = usePref(PrefKey.studentID);
  const [profileRaw, setProfileRaw] = usePrefJSON<unknown>(PrefKey.profile, null);
  const [programme] = usePrefJSON<TimetableCategory | null>(PrefKey.selectedProgramme, null);
  const [triedRaw, setTried] = usePrefJSON<Record<string, number>>(PrefKey.allocationTried, {});
  const [question, setQuestion] = usePrefJSON<SubgroupQuestion | null>(PrefKey.subgroupQuestion, null);
  const [programmeSaved, setProgrammeSaved] = usePref(PrefKey.programmeSaved);
  const [lastSeenSent, setLastSeenSent] = usePref(PrefKey.lastSeenSent);
  const profile = useMemo(() => decodeProfile(profileRaw), [profileRaw]);
  /**
   * A confirmation or password-reset link comes back to the website with the session in
   * the URL, which the site's index page hands to the app. Read at the first render, not
   * in an effect, because the address is cleared as it is read.
   */
  const [link] = useState(takeAuthLink);
  /** Set by a password-reset link, which signs the student in before anything is chosen. */
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(link?.kind === 'failed' ? link.message : null);

  const signOut = useCallback(() => {
    services.signOut();
    setUser(null);
    setResetting(false);
  }, [services]);

  // The session can die while the app is open; when it does the student is no longer
  // signed in, whatever the last launch recorded.
  useAppEvent('authSessionExpired', () => setUser(null));
  useAppEvent('signOutRequested', signOut);

  /**
   * Finishing that link — the account behind it is read back before the app trusts it — is
   * what saves the student retyping an email and password they have just proved they own.
   */
  useEffect(() => {
    if (link?.kind !== 'session' || !services.auth) return;
    let cancelled = false;
    void services.auth
      .completeEmailLink(link.tokens)
      .then((next) => {
        if (cancelled) return;
        services.user.save(next);
        setUser(next);
        if (link.type === 'recovery') setResetting(true);
      })
      .catch((error) => {
        if (!cancelled) setNotice(errorMessage(error, "That link didn't work. Sign in with your email and password."));
      });
    return () => {
      cancelled = true;
    };
  }, [link, services]);

  const flow: Flow =
    user === null ? 'signIn'
      : resetting ? 'newPassword'
        : !studentID ? 'studentID'
          : profile || programme ? 'shell'
            : 'programmePicker';

  // MARK: The timetable behind the shell

  const source = services.sourceOverride ?? services.dcu;
  const shell = useMemo<ShellConfig | null>(() => {
    if (flow !== 'shell') return null;
    if (profile) {
      return {
        key: `profile:${JSON.stringify(profile)}:${programme?.identity ?? ''}`,
        programme: { identity: `profile-${profile.group}`, name: 'Year 1 Engineering', categoryTypeIdentity: '' },
        source: services.sourceOverride ?? new ProfileTimetableSource(profile, services.rotationCache, services.dcu),
        audience: TimetableAudience.forProfile(profile, programme ? categoryCode(programme) : null),
        groupsAssigned: true,
      };
    }
    if (programme) {
      return {
        key: `programme:${programme.identity}`,
        programme,
        source,
        audience: TimetableAudience.forProgramme(categoryCode(programme)),
        groupsAssigned: false,
      };
    }
    return null;
  }, [flow, profile, programme, services, source]);

  const model = useMemo(() => {
    if (!shell) return null;
    return new WeekModel(services, shell.programme, shell.source, shell.audience);
    // Rebuilt only when the timetable itself changes, not on every render of the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.key, services]);
  // The one it replaces stops scheduling class alerts for a timetable that's gone.
  useEffect(() => () => model?.dispose(), [model]);

  // MARK: Keeping the class list, rotation and changes current

  // The picked programme goes up with the account, so signing back in — here or on another
  // phone — doesn't ask for it again. Also covers a programme picked before this was kept.
  useEffect(() => {
    if (!user || !programme) return;
    const saved = `${user.id}:${programme.identity}`;
    if (programmeSaved === saved) return;
    let cancelled = false;
    services.profiles
      .saveProgramme(programme)
      .then(() => !cancelled && setProgrammeSaved(saved))
      // Tried again next launch; the phone's own copy is what the timetable runs on.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, programme, programmeSaved, services, setProgrammeSaved]);

  /**
   * The day the app was last opened goes up with the account, the one measure of whether
   * students come back. Once a day at most: on launch, sign-in and return to the foreground.
   */
  const [foregrounded, setForegrounded] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForegrounded((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!user) return;
    const today = `${user.id}:${localDateString(new Date())}`;
    if (lastSeenSent === today) return;
    services.profiles
      .touchLastSeen()
      .then(() => setLastSeenSent(today))
      // Tried again on the next launch or return; a missed day only undercounts.
      .catch(() => undefined);
  }, [user, foregrounded, lastSeenSent, services, setLastSeenSent]);

  const refreshing = useRef(false);
  /** What the refresh reads when it runs — it outlives the render that started it. */
  const latest = useRef({ user, profile, programme, triedRaw, question });
  // Declared before the effects that refresh, so it has run by the time they do.
  useEffect(() => {
    latest.current = { user, profile, programme, triedRaw, question };
  });

  /**
   * A class list saved or corrected in the console bumps its version; a profile made from
   * the old one is resolved again rather than trusted, and a student on a picked programme
   * is looked up on the new list. On launch, sign-in and return to the foreground — one
   * version fetch when nothing has changed.
   */
  const refreshAllocation = useCallback(async () => {
    const { user: current, profile: savedProfile, programme: picked, triedRaw: tried, question: asked } = latest.current;
    const store = services.allocations;
    if (refreshing.current || !current || !store) return;
    refreshing.current = true;
    try {
      if (services.labRotations && (await LabRotationRefresh.run(ROTATION_COURSE_KEY, services.labRotations, services.rotationCache, bundledRotation()))) {
        services.events.emit('labRotationChanged');
      }

      // Changes for the course being shown: the profile's, or the picked programme's.
      const course = savedProfile
        ? TimetableAudience.forProfile(savedProfile).courseKey
        : picked ? TimetableAudience.forProgramme(categoryCode(picked))?.courseKey : undefined;
      if (course && services.timetableChanges && (await TimetableChangeRefresh.run(course, services.timetableChanges, services.changeCache))) {
        services.events.emit('timetableChangesChanged');
      }

      // By module, not course: they reach anyone whose timetable has the module.
      if (services.moduleSplits && (await ModuleSplitRefresh.run(services.moduleSplits, services.splitCache))) {
        services.events.emit('moduleSplitsChanged');
      }
      if (services.moduleTitles && (await ModuleTitleRefresh.run(services.moduleTitles, services.titleCache))) {
        services.events.emit('moduleTitlesChanged');
      }

      if (!savedProfile) {
        // No list for this programme's course means nothing to look up: it stays as picked.
        // Class lists are Engineering's only, so another course has nothing to ask about.
        if (!course || !cohortForCourseKey(course)) return;
        const outcome = await AllocationRefresh.adopt(userEmail(current)?.displayName ?? '', tried, store, course);
        if (outcome.kind === 'adopted') {
          // The picked programme is kept underneath, so a profile later dropped from the
          // list falls back to it rather than to an empty picker.
          setProfileRaw(outcome.profile as StudentProfile);
          setTried(null);
          setQuestion(null);
        } else if (outcome.kind === 'ask') {
          setTried(outcome.tried);
          setQuestion(outcome.question);
        } else {
          setTried(outcome.tried);
          // A list corrected since the question was asked has answered it some other way.
          if (asked && outcome.tried[asked.courseKey] !== asked.version) setQuestion(null);
        }
        return;
      }
      const outcome = await AllocationRefresh.check(savedProfile, store);
      if (outcome.kind === 'updated') setProfileRaw(outcome.profile);
      if (outcome.kind === 'dropped') {
        setProfileRaw(null);
      }
    } finally {
      refreshing.current = false;
    }
  }, [services, setProfileRaw, setTried, setQuestion]);

  // Also on picking a programme, which is when its class list is first worth asking about.
  useEffect(() => {
    void refreshAllocation();
  }, [user?.id, programme?.identity, refreshAllocation]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAllocation();
    });
    return () => sub.remove();
  }, [refreshAllocation]);

  /**
   * The week grid's abbreviations, set on the console's Timetable page. On launch, sign-in
   * and return to the foreground like the rest, and on a timer while the app is open, so a
   * phone left open on the timetable picks up a change too.
   */
  const refreshAbbreviations = useCallback(async () => {
    const store = services.moduleAbbreviations;
    if (!latest.current.user || !store || AppState.currentState !== 'active') return;
    if (await ModuleAbbreviationRefresh.run(store, services.abbreviationCache)) {
      services.events.emit('moduleAbbreviationsChanged');
    }
  }, [services]);

  useEffect(() => {
    void refreshAbbreviations();
    const timer = setInterval(() => void refreshAbbreviations(), ModuleAbbreviationRefresh.intervalMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAbbreviations();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [user?.id, refreshAbbreviations]);

  const signedIn = useCallback(
    (next: AuthenticatedUser) => {
      services.user.save(next);
      setUser(next);
    },
    [services],
  );

  const passwordResetDone = useCallback(() => setResetting(false), []);

  // Only while the student is on the programme whose list asked: a profile, or another
  // programme picked since, makes the question moot.
  const pickedCourse = programme ? TimetableAudience.forProgramme(categoryCode(programme))?.courseKey : undefined;
  const subgroupQuestion = flow === 'shell' && !profile && question && question.courseKey === pickedCourse ? question : null;

  const answerSubgroup = useCallback(async (subgroup: string): Promise<'adopted' | 'noMatch'> => {
    const store = services.allocations;
    if (!user || !store || !subgroupQuestion) return 'noMatch';
    const outcome = await AllocationRefresh.answer(userEmail(user)?.displayName ?? '', subgroupQuestion, subgroup, store);
    if (outcome.kind === 'adopted') {
      setProfileRaw(outcome.profile);
      setTried(null);
      setQuestion(null);
    }
    return outcome.kind;
  }, [services, user, subgroupQuestion, setProfileRaw, setTried, setQuestion]);

  const value = useMemo<RootState>(
    () => ({ flow, user, shell, model, notice, signedIn, signOut, passwordResetDone, subgroupQuestion, answerSubgroup }),
    [flow, user, shell, model, notice, signedIn, signOut, passwordResetDone, subgroupQuestion, answerSubgroup],
  );
  return <RootContext.Provider value={value}>{children}</RootContext.Provider>;
}
