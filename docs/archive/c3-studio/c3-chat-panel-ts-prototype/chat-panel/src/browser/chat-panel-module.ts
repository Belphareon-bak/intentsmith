/**
 * C3 Chat Panel — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { C3ChatPanelWidget } from './chat-panel-widget';
import { C3ChatPanelContribution } from './chat-panel-contribution';

export default new ContainerModule(bind => {
  bindViewContribution(bind, C3ChatPanelContribution);
  bind(FrontendApplicationContribution).toService(C3ChatPanelContribution);

  bind(C3ChatPanelWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: C3ChatPanelWidget.ID,
    createWidget: () => ctx.container.get(C3ChatPanelWidget),
  })).inSingletonScope();
});
