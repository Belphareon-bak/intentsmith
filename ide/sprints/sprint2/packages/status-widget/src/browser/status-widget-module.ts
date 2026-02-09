/**
 * C3 Status Widget — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { C3StatusWidgetContribution } from './status-widget-contribution';

export default new ContainerModule(bind => {
  bind(C3StatusWidgetContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(C3StatusWidgetContribution);
});
