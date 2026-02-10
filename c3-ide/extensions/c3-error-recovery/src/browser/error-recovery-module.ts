/**
 * @c3/error-recovery — Frontend DI module
 */
import { ContainerModule } from '@theia/core/shared/inversify';
import { C3ReconnectionManager } from './reconnection-manager';
import { C3LlmTimeoutManager } from './llm-timeout-manager';

export default new ContainerModule(bind => {
  bind(C3ReconnectionManager).toSelf().inSingletonScope();
  bind(C3LlmTimeoutManager).toSelf().inSingletonScope();
});
