/**
 * @intentsmith/notifications — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { IntentSmithNotificationService } from './notification-service';

export default new ContainerModule(bind => {
  bind(IntentSmithNotificationService).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(IntentSmithNotificationService);
});
