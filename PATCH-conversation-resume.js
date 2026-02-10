// ══════════════════════════════════════════════════════════════════════════════
// INTEGRATION PATCH: conversation.js — Session Resume Interceptor (Phase C1)
// ══════════════════════════════════════════════════════════════════════════════
//
// WHERE: chat/handlers/conversation.js
// WHEN: BEFORE the BUILD HANDOFF INTERCEPT block, AFTER imports
//
// ADD these imports at the top of conversation.js:
//
//   import {
//     detectResumeIntent,
//     handleResumeRequest,
//     handleProgressRequest,
//   } from './session-resume.js';
//   import { setHandoffState } from './build-handoff.js';
//
// ADD this block inside conversationHandler(), BEFORE the BUILD HANDOFF INTERCEPT:
//
// ════════════════════════════════════════════════════════════════════════════════

// --- BEGIN PATCH: Insert after `const { sessionId, sessionState } = context;`
//     and BEFORE `const activeHandoff = getActiveBuildHandoff(sessionId);`

  // ════════════════════════════════════════════════════════════════════════════
  // SESSION RESUME INTERCEPT — detect resume/progress requests (Phase C1)
  // ════════════════════════════════════════════════════════════════════════════
  const resumeIntent = detectResumeIntent(input);

  if (resumeIntent === 'resume') {
    const result = await handleResumeRequest(input, context, setHandoffState);
    if (result.handled) {
      return {
        content: result.content,
        tag: 'RESPONSE',
        speaker: 'SYSTEM',
        mode: context.mode || 'conversation',
        confidence: 1.0,
        metadata: {
          sessionResume: true,
          pendingChoice: result.pendingChoice || null,
        },
      };
    }
  }

  if (resumeIntent === 'progress') {
    const result = handleProgressRequest();
    if (result.handled) {
      return {
        content: result.content,
        tag: 'RESPONSE',
        speaker: 'SYSTEM',
        mode: context.mode || 'conversation',
        confidence: 1.0,
        metadata: { progressInquiry: true },
      };
    }
  }

  // Also handle numeric session selection after resume list was shown
  if (context.sessionState?.pendingResumeChoice) {
    const num = parseInt(input.trim());
    if (!isNaN(num) && num >= 1) {
      const choices = context.sessionState.pendingResumeChoice;
      const idx = num - 1;
      if (idx < choices.length) {
        const { restoreSession } = await import('./session-resume.js');
        const result = await restoreSession(
          sessionId,
          choices[idx].sessionId,
          setHandoffState,
        );
        // Clear pending choice
        delete context.sessionState.pendingResumeChoice;
        return {
          content: result.message,
          tag: 'RESPONSE',
          speaker: 'SYSTEM',
          mode: context.mode || 'conversation',
          confidence: 1.0,
          metadata: { sessionResume: true },
        };
      }
    }
    // Not a valid number — clear choice and continue normal flow
    delete context.sessionState.pendingResumeChoice;
  }
  // ════════════════════════════════════════════════════════════════════════════

// --- END PATCH

// ══════════════════════════════════════════════════════════════════════════════
// ALSO: In handleResumeRequest when pendingChoice is returned,
// store it in sessionState so the numeric handler above can pick it up.
// Modify the return block above to add:
//
//   if (result.pendingChoice) {
//     context.sessionState.pendingResumeChoice = result.pendingChoice;
//   }
//
// ══════════════════════════════════════════════════════════════════════════════
