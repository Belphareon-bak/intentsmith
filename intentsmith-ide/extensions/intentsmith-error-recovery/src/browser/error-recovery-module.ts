/**
 * @intentsmith/error-recovery — Frontend DI module
 */
import { ContainerModule } from '@theia/core/shared/inversify';
import { IntentSmithReconnectionManager } from './reconnection-manager';
import { IntentSmithLlmTimeoutManager } from './llm-timeout-manager';

export default new ContainerModule(bind => {
  bind(IntentSmithReconnectionManager).toSelf().inSingletonScope();
  bind(IntentSmithLlmTimeoutManager).toSelf().inSingletonScope();
});
