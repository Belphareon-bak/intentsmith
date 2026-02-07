// C.3 v57.0 — Notification Templates
// ══════════════════════════════════════════════════════════════════════════════

const PRIORITY_LABELS = {
  low: '🔵',
  normal: '🟢',
  high: '🔴',
};

/**
 * Generate HTML email body for a notification.
 */
export function toHTML(notification) {
  const icon = PRIORITY_LABELS[notification.priority] || '🟢';
  const time = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; background: #f5f5f5; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #1a1a2e; color: white; padding: 16px 24px;">
      <h2 style="margin: 0; font-size: 18px;">${icon} ${escapeHTML(notification.title)}</h2>
      <p style="margin: 4px 0 0; font-size: 12px; color: #aaa;">Agent: ${escapeHTML(notification.agentId)} | ${time}</p>
    </div>
    <div style="padding: 24px; line-height: 1.6; color: #333;">
      ${escapeHTML(notification.body).replace(/\n/g, '<br>')}
    </div>
    <div style="padding: 12px 24px; background: #f9f9f9; font-size: 11px; color: #999; border-top: 1px solid #eee;">
      p(AI)assistant — C3 Agent Platform
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate Markdown/Telegram-formatted text.
 */
export function toMarkdown(notification) {
  const icon = PRIORITY_LABELS[notification.priority] || '🟢';
  return `${icon} *${escapeMD(notification.title)}*\n\n${escapeMD(notification.body)}\n\n_Agent: ${escapeMD(notification.agentId)}_`;
}

/**
 * Generate plain text for fallback.
 */
export function toPlainText(notification) {
  return `[${notification.priority.toUpperCase()}] ${notification.title}\n\n${notification.body}\n\nAgent: ${notification.agentId}`;
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMD(str) {
  // Escape Telegram MarkdownV1 special chars (keep it simple)
  return String(str || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
