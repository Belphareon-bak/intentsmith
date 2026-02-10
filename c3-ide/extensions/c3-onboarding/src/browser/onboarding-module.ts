/**
 * @c3/onboarding — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core';
import { C3OnboardingWidget } from './onboarding-widget';
import { C3OnboardingContribution } from './onboarding-contribution';

export default new ContainerModule(bind => {
  bind(C3OnboardingWidget).toSelf().inSingletonScope();

  bind(C3OnboardingContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(C3OnboardingContribution);
  bind(CommandContribution).toService(C3OnboardingContribution);
});
