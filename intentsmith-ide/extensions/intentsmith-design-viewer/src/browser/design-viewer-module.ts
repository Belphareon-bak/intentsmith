/**
 * IntentSmith Design Viewer — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { IntentSmithDesignViewerWidget } from './design-viewer-widget';
import { IntentSmithDesignViewerContribution } from './design-viewer-contribution';
import { DesignImmutabilityGuard } from './design-immutability-guard';

export default new ContainerModule(bind => {
  // Widget
  bindViewContribution(bind, IntentSmithDesignViewerContribution);
  bind(FrontendApplicationContribution).toService(IntentSmithDesignViewerContribution);

  bind(IntentSmithDesignViewerWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: IntentSmithDesignViewerWidget.ID,
    createWidget: () => ctx.container.get(IntentSmithDesignViewerWidget),
  })).inSingletonScope();

  // Immutability guard
  bind(DesignImmutabilityGuard).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(DesignImmutabilityGuard);
});
