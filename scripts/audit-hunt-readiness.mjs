#!/usr/bin/env node
// Read-only cross-check of the installed provider, durable role bindings,
// current contract coverage and stored captures. This never grants GO.
import Database from 'better-sqlite3';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEvaluationReport } from './model-evaluation-report.js';
import { auditHuntCollections } from './audit-hunt-collections.mjs';
import { EVALUATION_PROVIDER_BUILD } from '../src/eval/evaluation-provider-build.js';
import { normalizeInstalledInventory } from '../src/upgrade/model-inventory.js';
import { auditResponsibilitySegregation } from '../src/upgrade/model-upgrade-prototype.js';

const providerUrl='http://127.0.0.1:11434';
async function getJson(path) {
  const response=await fetch(providerUrl+path,{signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`);
  return response.json();
}

export async function buildHuntReadiness({dbPath,inventory,runtimeProviderVersion}) {
  // The hunt launches an attested evaluation sidecar. The interactive Ollama
  // version is a separate runtime fact and must not invalidate sidecar captures.
  const evaluationProviderVersion=EVALUATION_PROVIDER_BUILD.version;
  const read=await buildEvaluationReport({dbPath,inventory,
    providerVersion:evaluationProviderVersion,runtimeProviderVersion});
  const db=new Database(dbPath,{readonly:true,fileMustExist:true});
  let captures;
  try { captures=auditHuntCollections(db,{providerVersion:evaluationProviderVersion}); }
  finally { db.close(); }
  const portfolio=auditResponsibilitySegregation(read.bindings,undefined,{inventory});
  const roleRows=Object.fromEntries(Object.entries(read.roles).map(([role,state])=>[role,{
    binding:state.binding,decisionReady:state.decisionReady,
    decisionBlockCode:state.decisionBlockCode,
    currentComplete:state.artifacts.filter(row=>row.applicable && row.status==='COMPLETE').length,
    currentMissing:state.coverage?.applicableMissing ?? null,
    structurallyCompatibleCaptures:captures.roles[role]?.compatibleRuns ?? 0,
    automaticReusableCaptures:captures.roles[role]?.automaticReusableRuns ?? 0,
    acceptedGraders:captures.roles[role]?.acceptedGraderCount,
  }]));
  const blockers=[];
  if (read.bindingAuthority?.status!=='VERIFIED_RUNTIME') blockers.push('BINDING_RUNTIME_NOT_VERIFIED');
  if (!portfolio.compliant) blockers.push('ROLE_PORTFOLIO_CONFLICT');
  if (!read.coverage?.applicableTotal || read.coverage.applicableStatusCounts?.COMPLETE!==read.coverage.applicableTotal)
    blockers.push('CURRENT_CONTRACT_COVERAGE_INCOMPLETE');
  if (Object.values(read.roles).some(role=>!role.decisionReady)) blockers.push('ROLE_ACCEPTANCE_INCOMPLETE');
  return {scope:'READ_ONLY_HUNT_READINESS',generatedAt:new Date().toISOString(),
    verdict:blockers.length?'NO_GO':'REVIEW_REQUIRED',decisionAuthority:false,effects:[],blockers,
    evaluationProviderVersion,runtimeProviderVersion,
    evaluationProviderAttested:false,coverage:read.coverage,bindingAuthority:read.bindingAuthority,
    portfolio:{compliant:portfolio.compliant,violations:portfolio.violations},
    captures:{compatibleRuns:captures.collections.length,
      automaticReusableRuns:captures.collections.filter(row=>row.automaticReuse).length,
      excludedSnapshots:captures.excludedSnapshots},roles:roleRows,
    note:'Reuse is conditional on the hunt launcher attesting and starting its pinned sidecar. This read-only report cannot grant GO.'};
}

function parseArgs(args) {
  if (args.length!==1 || !args[0].startsWith('--db='))
    throw new Error('Usage: node scripts/audit-hunt-readiness.mjs --db=/absolute/c3.db');
  const dbPath=args[0].slice(5);
  if (!isAbsolute(dbPath)) throw new Error('DATABASE_PATH_MUST_BE_ABSOLUTE');
  return dbPath;
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const dbPath=parseArgs(process.argv.slice(2));
    const [tags,version]=await Promise.all([getJson('/api/tags'),getJson('/api/version')]);
    if (!Array.isArray(tags.models) || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version.version||''))
      throw new Error('OLLAMA_IDENTITY_UNVERIFIED');
    const report=await buildHuntReadiness({dbPath,
      inventory:normalizeInstalledInventory(tags.models),runtimeProviderVersion:version.version});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  } catch(error) { console.error(`HUNT_READINESS_AUDIT_FAILED: ${error.message}`);process.exitCode=1; }
}
