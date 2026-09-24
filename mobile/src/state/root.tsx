import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { decodeProfile, StudentProfile, TimetableAudience } from '../core/profile';
import { categoryCode, TimetableCategory } from '../core/timetableEvent';
import { AllocationRefresh, LabRotationRefresh, TimetableChangeRefresh } from '../data/courseData';
import { TimetableSource } from '../data/dcuApi';
import { AuthenticatedUser, userEmail } from '../data/session';
import { PrefKey } from '../data/storage';
import { bundledRotation, ProfileTimetableSource, ROTATION_COURSE_KEY } from '../data/timetable';
import { WeekModel } from '../features/week/WeekModel';
import { useAppEvent, usePref, usePrefBool, usePrefJSON, useServices } from './hooks';

/** Which screen the app is on, decided from what the device remembers. */
export type Flow = 'signIn' | 'studentID' | 'profileCreator' | 'programmePicker' | 'shell';

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
  signedIn(user: AuthenticatedUser): void;
  signOut(): void;
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
 * Flow: sign in with a DCU address → student number from the card → the profile resolves
 * from the name in that address → timetable. "Choose a programme instead" covers anyone not
 * in the class list.
 */
export function RootProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const [user, setUser] = useState<AuthenticatedUser | null>(() => services.user.current);
  const [studentID] = usePref(PrefKey.studentID);
  const [profileRaw, setProfileRaw] = usePrefJSON<unknown>(PrefKey.profile, null);
  const [programme, setProgramme] = usePrefJSON<TimetableCategory | null>(PrefKey.selectedProgramme, null);
  const [useProgrammePicker] = usePrefBool(PrefKey.useProgrammePicker);
  const [, setHidden] = usePref(PrefKey.hiddenGroups);
  const [triedRaw, setTried] = usePrefJSON<Record<string, number>>(PrefKey.allocationTried, {});
  const profile = useMemo(() => decodeProfile(profileRaw), [profileRaw]);

  const signOut = useCallback(() => {
    services.signOut();
    setUser(null);
  }, [services]);

  // The session can die while the app is open; when it does the student is no longer
  // signed in, whatever the last launch recorded.
  useAppEvent('authSessionExpired', () => setUser(null));
  useAppEvent('signOutRequested', signOut);

  const flow: Flow =
    user === null ? 'signIn'
      : !studentID ? 'studentID'
        : profile || programme ? 'shell'
          : useProgrammePicker ? 'programmePicker'
            : 'profileCreator';

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
    const hidden = new Set(services.prefs.getJSON<string[]>(PrefKey.hiddenGroups, []));
    return new WeekModel(services, shell.programme, shell.source, shell.audience, hidden);
    // Rebuilt only when the timetable itself changes, not on every render of the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.key, services]);

  // MARK: Keeping the class list, rotation and changes current

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

      if (!savedProfile) {
        if (!picked) return;
        const outcome = await AllocationRefresh.adopt(userEmail(current)?.displayName ?? '', tried, store);
        if (outcome.kind === 'adopted') {
          setProfileRaw(outcome.profile as StudentProfile);
          setProgramme(null);
          setHidden(null);
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
        setHidden(null);
      }
    } finally {
      refreshing.current = false;
    }
  }, [services, setProfileRaw, setProgramme, setHidden, setTried]);

  useEffect(() => {
    void refreshAllocation();
  }, [user?.id, refreshAllocation]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAllocation();
    });
    return () => sub.remove();
  }, [refreshAllocation]);

  const signedIn = useCallback(
    (next: AuthenticatedUser) => {
      services.user.save(next);
      setUser(next);
    },
    [services],
  );

  const value = useMemo<RootState>(
    () => ({ flow, user, shell, model, signedIn, signOut }),
    [flow, user, shell, model, signedIn, signOut],
  );
  return <RootContext.Provider value={value}>{children}</RootContext.Provider>;
}
