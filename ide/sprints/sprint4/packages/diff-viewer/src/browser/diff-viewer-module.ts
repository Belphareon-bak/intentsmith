/**
 * @c3/diff-viewer — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { C3DiffProposalManager } from './diff-proposal-manager';

export default new ContainerModule(bind => {
  bind(C3DiffProposalManager).toSelf().inSingletonScope();
});
