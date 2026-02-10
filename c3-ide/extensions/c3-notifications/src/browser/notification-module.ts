/**
 * @c3/notifications — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { C3NotificationService } from './notification-service';

export default new ContainerModule(bind => {
  bind(C3NotificationService).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(C3NotificationService);
});
