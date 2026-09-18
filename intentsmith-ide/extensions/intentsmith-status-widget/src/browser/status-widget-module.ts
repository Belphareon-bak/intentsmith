/**
 * IntentSmith Status Widget — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { IntentSmithStatusWidgetContribution } from './status-widget-contribution';

export default new ContainerModule(bind => {
  bind(IntentSmithStatusWidgetContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(IntentSmithStatusWidgetContribution);
});
