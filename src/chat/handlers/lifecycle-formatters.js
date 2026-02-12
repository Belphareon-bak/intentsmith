// Lifecycle Formatters — Response formatting for lifecycle phases
// ══════════════════════════════════════════════════════════════════════════════
// All format* functions for lifecycle handoff responses.
// Split from lifecycle-handoff.js for modularity.
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';

// ─── Helper: create TaggedResponse ──────────────────────────────────────────

export function lcResponse(content, metadata = {}) {
  return new TaggedResponse({
    content,
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.PROJECT,
      confidence: 0.9,
      canExecute: false,
      metadata: { lifecycleHandoff: true, ...metadata },
    }),
  });
}

// ─── Rendering helper ────────────────────────────────────────────────────────

function renderItem(item) {
  if (typeof item === 'string') return item;
  return item?.description ?? item?.id ?? JSON.stringify(item);
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function formatSpecQuestions(questions) {
  const qs = questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n');
  return [
    `📋 **Specifikační fáze**`,
    ``,
    `Potřebuji upřesnit několik věcí:`,
    ``,
    qs,
    ``,
    `Odpověz na otázky (můžeš jedním souhrnným textem).`,
  ].join('\n');
}

export function formatSpec(spec) {
  const lines = [`📄 **Specifikace projektu**`, ``];

  if (spec.title) lines.push(`**${spec.title}**`, ``);
  if (spec.description) lines.push(spec.description, ``);

  if (spec.goals && spec.goals.length > 0) {
    lines.push('**Cíle:**');
    for (const g of spec.goals) {
      const priority = (typeof g !== 'string' && g?.priority) ? `[${g.priority}] ` : '';
      lines.push(`  - ${priority}${renderItem(g)}`);
    }
    lines.push('');
  }

  if (spec.requirements && spec.requirements.length > 0) {
    lines.push('**Požadavky:**');
    for (const r of spec.requirements) lines.push(`  - ${renderItem(r)}`);
    lines.push('');
  }

  if (spec.tech_stack) {
    lines.push('**Tech stack:**');
    if (spec.tech_stack.languages) lines.push(`  Jazyky: ${spec.tech_stack.languages.join(', ')}`);
    if (spec.tech_stack.frameworks) lines.push(`  Frameworky: ${spec.tech_stack.frameworks.join(', ')}`);
    if (spec.tech_stack.databases) lines.push(`  Databáze: ${spec.tech_stack.databases.join(', ')}`);
    lines.push('');
  }

  if (spec.risks && spec.risks.length > 0) {
    lines.push('**Rizika:**');
    for (const r of spec.risks) {
      const severity = (typeof r !== 'string' && r?.severity) ? ` [${r.severity}]` : '';
      lines.push(`  ⚠️ ${renderItem(r)}${severity}`);
    }
    lines.push('');
  }

  lines.push('Schválíš specifikaci? (ano, nebo napiš feedback pro úpravu)');
  return lines.join('\n');
}

export function formatRoadmap(roadmapResult) {
  const lines = [`🗺️ **Roadmapa projektu**`, ``];

  const milestones = roadmapResult.milestones || roadmapResult.roadmap?.milestones || [];

  if (milestones.length > 0) {
    lines.push(`**${milestones.length} milníků:**`, ``);
    for (const ms of milestones) {
      const deps = ms.depends_on?.length > 0 ? ` (závisí na: ${ms.depends_on.join(', ')})` : '';
      const loc = ms.estimated_loc ? ` ~${ms.estimated_loc} LOC` : '';
      const files = ms.estimated_files ? `, ~${ms.estimated_files} souborů` : '';
      const seq = ms.sequence || parseInt(ms.id?.replace('ms-', ''), 10) || (milestones.indexOf(ms) + 1);
      lines.push(`  ${seq}. **${ms.title || ms.id}**${deps}`);
      if (ms.description) lines.push(`     ${ms.description}`);
      lines.push(`     ${loc}${files}`);
    }
    lines.push('');
  }

  if (roadmapResult.warnings && roadmapResult.warnings.length > 0) {
    lines.push('**Varování:**');
    for (const w of roadmapResult.warnings) lines.push(`  ⚠️ ${w}`);
    lines.push('');
  }

  lines.push('Schválíš roadmapu? (ano, nebo napiš feedback pro úpravu)');
  return lines.join('\n');
}

export function formatMilestonePlan(msResult) {
  const lines = [
    `🎯 **Milník: ${msResult.title || msResult.milestoneId}**`,
    ``,
  ];

  if (msResult.description) lines.push(msResult.description, ``);

  if (msResult.localPlan) {
    const plan = msResult.localPlan;
    if (plan.steps && plan.steps.length > 0) {
      lines.push('**Kroky:**');
      for (const step of plan.steps) {
        lines.push(`  ${step.seq || '?'}. ${step.action || step.description || '?'}`);
      }
      lines.push('');
    }

    if (plan.scope_files && plan.scope_files.length > 0) {
      lines.push(`**Scope soubory:** ${plan.scope_files.join(', ')}`, ``);
    }
  }

  if (msResult.estimatedLoc) lines.push(`Odhad: ~${msResult.estimatedLoc} LOC, ~${msResult.estimatedFiles || '?'} souborů`);
  lines.push('');
  lines.push('Schválíš plán milníku a spustíš build? (ano/ne/skip)');

  return lines.join('\n');
}

export function formatMilestoneBlocked(result) {
  return [
    `🚫 **Milník zablokován**`,
    ``,
    `Důvod: ${result.error || result.reason || 'Neznámý'}`,
    `Pokusy: ${result.retryCount || '?'}/${result.maxRetries || '?'}`,
    ``,
    `Co chceš udělat?`,
    `  - "retry" — zkusit znovu`,
    `  - "skip" — přeskočit milník`,
    `  - "změna: ..." — upravit přístup`,
  ].join('\n');
}

export function formatMilestoneProgress(result) {
  return [
    `⚙️ **Milník se staví...**`,
    ``,
    `Status: ${result.status || 'EXECUTING'}`,
    result.progress ? `Progress: ${result.progress}%` : '',
  ].filter(Boolean).join('\n');
}

export function formatBuildProgress(progress) {
  if (!progress) return 'Žádná data o průběhu.';

  const lines = [`📊 **Průběh buildu**`, ``];

  if (progress.percentage !== undefined) {
    const bar = progressBar(progress.percentage);
    lines.push(`${bar} ${progress.percentage}%`, ``);
  }

  if (progress.byStatus) {
    const s = progress.byStatus;
    const parts = [];
    if (s.PASSED) parts.push(`✅ ${s.PASSED} hotovo`);
    if (s.EXECUTING) parts.push(`⚙️ ${s.EXECUTING} probíhá`);
    if (s.PENDING) parts.push(`⏳ ${s.PENDING} čeká`);
    if (s.BLOCKED) parts.push(`🚫 ${s.BLOCKED} blokováno`);
    if (s.SKIPPED) parts.push(`⏭️ ${s.SKIPPED} přeskočeno`);
    if (parts.length > 0) lines.push(parts.join(' | '));
  }

  return lines.join('\n');
}

export function formatReview(reviewResult) {
  const lines = [`🔍 **Project Review**`, ``];

  if (reviewResult.overallHealth) {
    lines.push(`Celkové zdraví: **${reviewResult.overallHealth}**`, ``);
  }

  if (reviewResult.checks && reviewResult.checks.length > 0) {
    lines.push('**Drift checks:**');
    for (const check of reviewResult.checks) {
      const icon = check.result === 'PASS' ? '✅' : check.result === 'WARN' ? '⚠️' : '❌';
      lines.push(`  ${icon} ${check.type}: ${check.result || check.status || '?'}`);
    }
    lines.push('');
  }

  if (reviewResult.recommendations && reviewResult.recommendations.length > 0) {
    lines.push('**Doporučení:**');
    for (const r of reviewResult.recommendations) lines.push(`  💡 ${r}`);
    lines.push('');
  }

  lines.push(`Milníky: ${reviewResult.completedMilestones || '?'}/${reviewResult.totalMilestones || '?'}`, ``);
  lines.push('Co chceš dělat? (pokračovat/změna/status)');

  return lines.join('\n');
}

export function formatChangeProposal(result) {
  const lines = [`🔄 **Návrh změny**`, ``];

  if (result.description) lines.push(`Popis: ${result.description}`, ``);

  if (result.impact) {
    lines.push('**Dopad:**');
    if (result.impact.affected_milestones) {
      lines.push(`  Ovlivněné milníky: ${result.impact.affected_milestones.join(', ')}`);
    }
    if (result.impact.risk_level) {
      lines.push(`  Úroveň rizika: ${result.impact.risk_level}`);
    }
    lines.push('');
  }

  lines.push('Schválíš změnu? (ano/ne)');
  return lines.join('\n');
}

export function formatChangeApplied(result) {
  return [
    `✅ **Změna aplikována**`,
    ``,
    `Nová verze roadmapy: v${result.newVersion || '?'}`,
    result.diffSummary ? `Diff: ${result.diffSummary}` : '',
    ``,
    `Pokračuji v BUILD fázi.`,
  ].filter(Boolean).join('\n');
}

export function formatProjectCompleted(progress) {
  const lines = [
    `🎉 **Projekt dokončen!**`,
    ``,
  ];

  if (progress) {
    lines.push(formatBuildProgress(progress));
    lines.push('');
  }

  lines.push('Všechny milníky jsou hotové. Lifecycle ukončen.');
  return lines.join('\n');
}

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}
