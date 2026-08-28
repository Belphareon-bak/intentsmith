import {
  M6_ACCEPTANCE_RECEIPT_PATHS,
  M6_OPERATOR_DEMO_STEPS,
} from './acceptance-authority-v1.js';
import {
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_ROLE,
} from '../authority/signed-authority-receipt-v1.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const M6_OPERATOR_DEMO_INPUT_CONTRACT = 'M6OperatorDemoInput';
export const M6_OPERATOR_DEMO_OBSERVATION_CONTRACT = 'M6OperatorDemoObservation';
export const M6_OPERATOR_DEMO_CONTRACT_VERSION = 1;
export const M6_OPERATOR_DEMO_OBSERVATION_STAGE = 'OBSERVATION_ONLY_NOT_APPROVAL';

const OBJECTIVES = {
  'open-project': 'Open the pinned Git project from the production Studio build.',
  'resume-conversation': 'Resume an existing conversation without losing history or project identity.',
  'deterministic-turn': 'Complete a deterministic turn and inspect its typed terminal.',
  'model-turn': 'Complete a local-model turn with exact model identity visible in evidence.',
  'approve-change': 'Approve one bounded change and inspect plan, effect, test, diff and audit.',
  'negative-effect': 'Exercise cancel, error or recovery without a false success terminal.',
  'specialist-agent': 'Run the specialist and extension-agent path through governed authority.',
  learning: 'Inspect one explicitly approved learning item and its project boundary.',
  'model-discovery': 'Exercise the enabled model-discovery conditional journey.',
};

export const M6_OPERATOR_DEMO_PLAN_V1 = deepFreeze({
  contract: 'M6OperatorDemoPlan',
  version: 1,
  stage: M6_OPERATOR_DEMO_OBSERVATION_STAGE,
  authority: 'OPERATOR_OBSERVATION_REQUIRED',
  candidateRequirements: {
    cleanTree: true,
    exactHeadAndTree: true,
    standaloneCheckout: true,
    productionBuild: true,
    freshCloneObservedByOperator: true,
    unexpectedEgressAttemptsMaximum: 0,
  },
  steps: M6_OPERATOR_DEMO_STEPS.map(id => ({
    id,
    objective: OBJECTIVES[id],
    allowedStatuses: ['PASS', 'FAIL', 'NOT_RUN'],
    artifactMinimum: 1,
  })),
  output: {
    observationStage: M6_OPERATOR_DEMO_OBSERVATION_STAGE,
    approvalReceiptAuthorityId: SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
    approvalReceiptDomain: SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
    approvalReceiptPath: M6_ACCEPTANCE_RECEIPT_PATHS['operator-demo-approval'],
    automaticApproval: 'forbidden',
  },
});

export const M6_OPERATOR_DEMO_PLAN_DIGEST_V1 =
  'a3b4a5ccf25e99ab8844ff6ffa76a7f2640c7539c5840cfd26c217fba87de5c0';
