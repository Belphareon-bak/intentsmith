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

const FEATURE_SYNC_KEYS = new Set([
  'c3.features.agents',
  'c3.features.lifecycle',
  'c3.features.expertises',
  'c3.features.telemetry',
  'c3.features.specialistTelemetry',
  'c3.features.autonomy',
  'c3.features.skills',
]);

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
          if (FEATURE_SYNC_KEYS.has(event.preferenceName)
            && typeof event.newValue === 'boolean') {
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
