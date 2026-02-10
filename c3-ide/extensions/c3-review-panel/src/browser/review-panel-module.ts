/**
 * @c3/review-panel — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { C3ReviewPanelWidget } from './review-panel-widget';
import { C3ReviewPanelContribution } from './review-panel-contribution';

export default new ContainerModule(bind => {
  bindViewContribution(bind, C3ReviewPanelContribution);
  bind(FrontendApplicationContribution).toService(C3ReviewPanelContribution);

  bind(C3ReviewPanelWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: C3ReviewPanelWidget.ID,
    createWidget: () => ctx.container.get(C3ReviewPanelWidget),
  })).inSingletonScope();
});
