/**
 * IntentSmith Agent Log Panel — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  WidgetFactory,
  FrontendApplicationContribution,
  bindViewContribution,
} from '@theia/core/lib/browser';
import { IntentSmithAgentPanelWidget } from './agent-panel-widget';
import { IntentSmithAgentPanelContribution } from './agent-panel-contribution';

export default new ContainerModule(bind => {
  bindViewContribution(bind, IntentSmithAgentPanelContribution);
  bind(FrontendApplicationContribution).toService(IntentSmithAgentPanelContribution);

  bind(IntentSmithAgentPanelWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: IntentSmithAgentPanelWidget.ID,
    createWidget: () => ctx.container.get(IntentSmithAgentPanelWidget),
  })).inSingletonScope();
});
