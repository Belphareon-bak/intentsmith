/**
 * @intentsmith/review-panel — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { IntentSmithReviewPanelWidget } from './review-panel-widget';
import { IntentSmithReviewPanelContribution } from './review-panel-contribution';

export default new ContainerModule(bind => {
  bindViewContribution(bind, IntentSmithReviewPanelContribution);
  bind(FrontendApplicationContribution).toService(IntentSmithReviewPanelContribution);

  bind(IntentSmithReviewPanelWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: IntentSmithReviewPanelWidget.ID,
    createWidget: () => ctx.container.get(IntentSmithReviewPanelWidget),
  })).inSingletonScope();
});
