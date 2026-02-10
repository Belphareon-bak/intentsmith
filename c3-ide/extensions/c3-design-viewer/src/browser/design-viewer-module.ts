/**
 * C3 Design Viewer — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { C3DesignViewerWidget } from './design-viewer-widget';
import { C3DesignViewerContribution } from './design-viewer-contribution';
import { DesignImmutabilityGuard } from './design-immutability-guard';

export default new ContainerModule(bind => {
  // Widget
  bindViewContribution(bind, C3DesignViewerContribution);
  bind(FrontendApplicationContribution).toService(C3DesignViewerContribution);

  bind(C3DesignViewerWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: C3DesignViewerWidget.ID,
    createWidget: () => ctx.container.get(C3DesignViewerWidget),
  })).inSingletonScope();

  // Immutability guard
  bind(DesignImmutabilityGuard).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(DesignImmutabilityGuard);
});
