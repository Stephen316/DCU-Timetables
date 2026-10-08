import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cohortForCourseKey, decodeProfile, StudentProfile, TimetableAudience } from '../core/profile';
import { categoryCode, TimetableCategory } from '../core/timetableEvent';
import { AllocationRefresh, LabRotationRefresh, ModuleSplitRefresh, ModuleTitleRefresh, TimetableChangeRefresh } from '../data/courseData';
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
  title: string;
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
  const [programmeSaved, setProgrammeSaved] = usePref(PrefKey.programmeSaved);
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
        key: `profile:${JSON.stringify(profile)}`,
        programme: { identity: `profile-${profile.group}`, name: 'Year 1 Engineering', categoryTypeIdentity: '' },
        source: services.sourceOverride ?? new ProfileTimetableSource(profile, services.rotationCache, services.dcu),
        title: 'Year 1 Eng',
        audience: TimetableAudience.forProfile(profile),
        groupsAssigned: true,
      };
    }
    if (programme) {
      return {
        key: `programme:${programme.identity}`,
        programme,
        source,
        title: categoryCode(programme),
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

  const refreshing = useRef(false);
  /** What the refresh reads when it runs — it outlives the render that started it. */
  const latest = useRef({ user, profile, programme, triedRaw });
  // Declared before the effects that refresh, so it has run by the time they do.
  useEffect(() => {
    latest.current = { user, profile, programme, triedRaw };
  });

  /**
   * A class list saved or corrected in the console bumps its version; a profile made from
   * the old one is resolved again rather than trusted, and a student on a picked programme
   * is looked up on the new list. On launch, sign-in and return to the foreground — one
   * version fetch when nothing has changed.
   */
  const refreshAllocation = useCallback(async () => {
    const { user: current, profile: savedProfile, programme: picked, triedRaw: tried } = latest.current;
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
        } else {
          setTried(outcome.tried);
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
  }, [services, setProfileRaw, setTried]);

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
   * The week grid's abbreviations, from the console's Abbreviations page. On launch, sign-in
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

  const value = useMemo<RootState>(
    () => ({ flow, user, shell, model, notice, signedIn, signOut, passwordResetDone }),
    [flow, user, shell, model, notice, signedIn, signOut, passwordResetDone],
  );
  return <RootContext.Provider value={value}>{children}</RootContext.Provider>;
}
