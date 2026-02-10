/**
 * C3 Agent Log Panel — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { C3AgentPanelWidget } from './agent-panel-widget';
import { C3AgentPanelContribution } from './agent-panel-contribution';

export default new ContainerModule(bind => {
  bindViewContribution(bind, C3AgentPanelContribution);
  bind(FrontendApplicationContribution).toService(C3AgentPanelContribution);

  bind(C3AgentPanelWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: C3AgentPanelWidget.ID,
    createWidget: () => ctx.container.get(C3AgentPanelWidget),
  })).inSingletonScope();
});
