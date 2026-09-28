import { ModuleAbbreviation, ModuleAbbreviations } from '../core/abbreviations';
import { rows, SupabaseREST } from './rest';
import { PrefKey, Prefs } from './storage';

const describe = (status: number) => `The server returned ${status}.`;

/** The week-grid abbreviations set in the console, for every module. */
export interface ModuleAbbreviationStore {
  abbreviations(): Promise<ModuleAbbreviation[]>;
}

export class SupabaseModuleAbbreviationStore implements ModuleAbbreviationStore {
  constructor(private readonly rest: SupabaseREST) {}

  /** Every module's: a few rows each, and which modules a student takes is known only later. */
  async abbreviations(): Promise<ModuleAbbreviation[]> {
    // Signed in or not at all: the anon key reads an empty table, which would wipe the cache.
    const json = await this.rest.json('GET', '/rest/v1/module_abbreviations', describe, {
      auth: 'userOnly',
      query: [
        ['select', 'module_key,abbreviation'],
        // A module that is only flagged has no abbreviation yet.
        ['abbreviation', 'not.is.null'],
        ['order', 'module_key'],
      ],
    });
    return rows(json).flatMap((r) => {
      const a = ModuleAbbreviations.fromRow(r);
      return a ? [a] : [];
    });
  }
}

/** The last abbreviations downloaded, so they hold with no signal. */
export class ModuleAbbreviationCache {
  constructor(private readonly prefs: Prefs) {}

  abbreviations(): ModuleAbbreviation[] {
    return this.prefs.getJSON<ModuleAbbreviation[]>(PrefKey.moduleAbbreviations, []);
  }

  store(list: ModuleAbbreviation[]): void {
    this.prefs.setJSON(PrefKey.moduleAbbreviations, list);
  }
}

export const ModuleAbbreviationRefresh = {
  /**
   * How often the app asks again while it stays open, on top of launch, sign-in and coming
   * back to the foreground. One small read; an unchanged answer changes nothing on screen.
   */
  intervalMs: 15 * 60_000,

  /** True when the abbreviations differ from what is cached. A failed request keeps the cache. */
  async run(store: ModuleAbbreviationStore, cache: ModuleAbbreviationCache): Promise<boolean> {
    let fresh: ModuleAbbreviation[];
    try {
      fresh = await store.abbreviations();
    } catch {
      return false;
    }
    if (JSON.stringify(fresh) === JSON.stringify(cache.abbreviations())) return false;
    cache.store(fresh);
    return true;
  },
};
