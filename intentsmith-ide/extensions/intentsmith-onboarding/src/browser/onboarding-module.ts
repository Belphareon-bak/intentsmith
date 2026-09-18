/**
 * @intentsmith/onboarding — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core';
import { IntentSmithOnboardingWidget } from './onboarding-widget';
import { IntentSmithOnboardingContribution } from './onboarding-contribution';

export default new ContainerModule(bind => {
  bind(IntentSmithOnboardingWidget).toSelf().inSingletonScope();

  bind(IntentSmithOnboardingContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(IntentSmithOnboardingContribution);
  bind(CommandContribution).toService(IntentSmithOnboardingContribution);
});
