/**
 * @intentsmith/diff-viewer — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { IntentSmithDiffProposalManager } from './diff-proposal-manager';

export default new ContainerModule(bind => {
  bind(IntentSmithDiffProposalManager).toSelf().inSingletonScope();
});
