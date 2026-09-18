/**
 * @intentsmith/settings — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  PreferenceContribution,
  PreferenceService,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { INTENTSMITH_PREFERENCE_SCHEMA } from './settings-contribution';

export default new ContainerModule(bind => {
  bind(PreferenceContribution).toConstantValue({
    schema: INTENTSMITH_PREFERENCE_SCHEMA,
  });

  // v85: Sync feature toggles to backend on preference change
  bind(FrontendApplicationContribution).toDynamicValue(ctx => {
    const prefs = ctx.container.get(PreferenceService);
    return {
      onStart(): void {
        prefs.onPreferenceChanged(event => {
          // v87: Sync features, LLM, memory, system, account settings to backend
          const syncPrefixes = ['intentsmith.features.', 'intentsmith.llm.', 'intentsmith.memory.', 'intentsmith.system.', 'intentsmith.account.', 'intentsmith.notif.'];
          if (syncPrefixes.some(p => event.preferenceName.startsWith(p))) {
            const ws = (window as any).IntentSmithWS;
            if (ws && typeof ws.syncSettings === 'function' && ws.isReady()) {
              ws.syncSettings({ [event.preferenceName]: event.newValue });
            }
          }
        });
      },
    };
  }).inSingletonScope();
});
