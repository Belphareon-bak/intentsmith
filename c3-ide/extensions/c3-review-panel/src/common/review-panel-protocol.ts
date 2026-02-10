/**
 * @c3/review-panel — Protocol (common)
 *
 * Review Panel shows the list of proposed changes from the agent.
 * Each change can be individually reviewed (accept/reject/edit).
 *
 * Auto-opens when:
 *   - Agent creates a new change set
 *   - IDE starts with phase === 'pending_review'
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │ 🔍 Code Review — Sprint 1       │
 *   ├──────────────────────────────────┤
 *   │ ✅ lib/main.dart      +12 -3    │
 *   │ ⏳ lib/vpn_service.dart +45 -0  │  ← click opens diff
 *   │ ⏳ test/vpn_test.dart  +28 -0   │
 *   ├──────────────────────────────────┤
 *   │ [Accept All] [Reject All]        │
 *   │ Progress: 1/3 reviewed           │
 *   └──────────────────────────────────┘
 */

export const REVIEW_PANEL_WIDGET_ID = 'c3:review-panel';

export interface ReviewPanelState {
  /** Whether the panel has an active change set */
  hasChangeSet: boolean;
  /** Change set label */
  label: string;
  /** Total proposals */
  total: number;
  /** How many reviewed (not pending) */
  reviewed: number;
  /** How many accepted */
  accepted: number;
  /** How many rejected */
  rejected: number;
  /** How many edited */
  edited: number;
  /** Whether "Apply" is available (all reviewed, at least one accepted) */
  canApply: boolean;
}
