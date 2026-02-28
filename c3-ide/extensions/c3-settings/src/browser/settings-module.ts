/**
 * @c3/settings — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  PreferenceContribution,
  PreferenceService,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { C3_PREFERENCE_SCHEMA } from './settings-contribution';

export default new ContainerModule(bind => {
  bind(PreferenceContribution).toConstantValue({
    schema: C3_PREFERENCE_SCHEMA,
  });

  // v85: Sync feature toggles to backend on preference change
  bind(FrontendApplicationContribution).toDynamicValue(ctx => {
    const prefs = ctx.container.get(PreferenceService);
    return {
      onStart(): void {
        prefs.onPreferenceChanged(event => {
          // v87: Sync features, LLM, memory, system, account settings to backend
          const syncPrefixes = ['c3.features.', 'c3.llm.', 'c3.memory.', 'c3.system.', 'c3.account.'];
          if (syncPrefixes.some(p => event.preferenceName.startsWith(p))) {
            const ws = (window as any).C3WS;
            if (ws && typeof ws.syncSettings === 'function' && ws.isReady()) {
              ws.syncSettings({ [event.preferenceName]: event.newValue });
            }
          }
        });
      },
    };
  }).inSingletonScope();
});
