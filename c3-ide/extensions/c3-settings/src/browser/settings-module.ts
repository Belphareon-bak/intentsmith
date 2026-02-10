/**
 * @c3/settings — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { PreferenceContribution } from '@theia/core/lib/browser';
import { C3_PREFERENCE_SCHEMA } from './settings-contribution';

export default new ContainerModule(bind => {
  bind(PreferenceContribution).toConstantValue({
    schema: C3_PREFERENCE_SCHEMA,
  });
});
