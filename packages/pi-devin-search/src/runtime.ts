import type { OAuthOptions } from '../../../src/oauth.js';
import { WindsurfCompletion, type Completion } from '../../../src/completion.js';
import { webProvider, type SearchProvider } from '../../../src/web.js';
import { AuthSession } from './session.js';
import { AuthStore } from './store.js';
import { SettingsStore } from './settings.js';

export interface RuntimeFixtures {
  oauth?: OAuthOptions;
  web?: Parameters<typeof webProvider>[1];
  completion?: Completion;
}

/**
 * Session-scoped credential owner and cloud clients.
 * Construct only from session_start (or a test), never from the extension factory.
 */
export interface SearchRuntime {
  readonly store: AuthStore;
  readonly session: AuthSession;
  readonly settings: SettingsStore;
  readonly cloud: WindsurfCompletion;
  readonly completion: Completion;
  readonly web: SearchProvider;
  dispose(): Promise<void>;
}

export function createSearchRuntime(agentDir: string, fixtures: RuntimeFixtures = {}): SearchRuntime {
  const store = new AuthStore(agentDir);
  const settings = new SettingsStore(agentDir);
  let cloud!: WindsurfCompletion;
  const session = new AuthSession(store, { ...fixtures.oauth, onInvalidate: () => cloud?.invalidate() });
  cloud = new WindsurfCompletion(session, fixtures.oauth);
  const web = webProvider(session, fixtures.web);
  let disposed = false;
  return {
    store, session, settings, cloud,
    completion: fixtures.completion ?? cloud,
    web,
    async dispose() {
      if (disposed) return;
      disposed = true;
      cloud.invalidate();
      await session.dispose();
    },
  };
}
