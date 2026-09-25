#!/usr/bin/env python3
"""Read-only reconciliation of the 2026-09-25 hunt campaign for human review.

No grader, model inference, database write, role recommendation or activation.
The packet is checked byte-for-byte against the current D/R public prompts and
rubrics.  A precommitted sample is selected before any review is opened.
"""
import collections
import datetime as dt
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
EVIDENCE = pathlib.Path('/mnt/vi7000/intentsmith/evidence')
PACKET = EVIDENCE / 'hunt-isolated-20260925/blind/packet.json'
CAMPAIGN = ROOT / 'docs/review/evidence/2026-09-25-hunt-isolated-campaign.json'
TASKS = ROOT / 'src/eval/fixtures/role-semantic-tasks.json'
SEMANTIC_AUDIT = ROOT / 'docs/review/evidence/2026-09-25-hunt-semantic-source-context.json'
CHAT_PLAN = EVIDENCE / 'hunt-chat-panel-20260923/capture/plan.json'
CHAT_SUMMARY = EVIDENCE / 'hunt-chat-panel-20260923/capture/summary.json'
CHAT_REVIEW = EVIDENCE / 'hunt-chat-panel-20260923/review-full-05/review.json'
CHAT_KEY = EVIDENCE / 'hunt-chat-panel-20260923/review-full-05/PRIVATE-identity-key.json'
CANARY_RUN = EVIDENCE / 'hunt-chat-production-canary-20260925/run-equal-4096'
CODE_ROOT = EVIDENCE / 'hunt-code-capture-20260925'
CODEX_SAMPLE = ROOT / 'docs/review/evidence/2026-09-25-hunt-codex-presampled-review.json'
CODEX_R2 = ROOT / 'docs/review/evidence/2026-09-25-hunt-codex-r2-development-review.json'
OUT = ROOT / 'docs/review/evidence/2026-09-25-hunt-step3-readiness.json'
DOC = ROOT / 'docs/review/2026-09-25-HUNT-STEP3-READINESS.md'
ROLES = ('D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read(path):
    data = path.read_bytes()
    return json.loads(data), sha(data)

def get_json(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)

def rank(seed, *parts):
    return sha(('\x00'.join((seed, *parts))).encode())

def main():
    packet, packet_sha = read(PACKET)
    campaign, campaign_sha = read(CAMPAIGN)
    fixture, fixture_sha = read(TASKS)
    semantic_audit, semantic_audit_sha = read(SEMANTIC_AUDIT)
    assert semantic_audit['status'] == 'SOURCE_FIDELITY_PASS' and semantic_audit['fixtureSha256'] == fixture_sha
    faithful_tasks = {row['task'] for row in semantic_audit['results'] if row['sourceFaithful']}
    assert len(faithful_tasks) == 32
    chat_wrapper, chat_plan_sha = read(CHAT_PLAN)
    chat_summary, chat_summary_sha = read(CHAT_SUMMARY)
    chat_review, chat_review_sha = read(CHAT_REVIEW)
    chat_key, chat_key_sha = read(CHAT_KEY)
    chat_identity = {item['id']: item['model'] for item in chat_key['identities']}
    assert len(chat_identity) == len(chat_review['items']) == 1200
    captured_by_model = collections.Counter(chat_identity[item['id']] for item in chat_review['items'] if item['captureStatus'] == 'CAPTURED')
    assert sum(captured_by_model.values()) == chat_summary['capturedConversations']
    canary_plan, canary_plan_file_sha = read(CANARY_RUN / 'plan.json')
    canary_result, canary_result_sha = read(CANARY_RUN / 'result.json')
    assert canary_result['status'] == 'COLLECTION_COMPLETE' and not canary_result['unattempted']
    assert canary_result['planSha256'] == canary_plan['planSha256'] and len(canary_result['attempts']) == 8
    assert all(a['status'] == 'CAPTURED' and a['proof'] == 'RESPONSE_BOUND' for a in canary_result['attempts'])
    canary_models = {p['model'] for p in canary_plan['pairs']['CHAT']}
    assert canary_models == {'qwen3.8:latest', 'qwen3.5:27b'}
    code_captures = {}
    code_sources = {}
    for directory in ('qwen38', 'qwen35'):
        capture_plan, plan_file_sha = read(CODE_ROOT / directory / 'plan.json')
        capture_result, result_file_sha = read(CODE_ROOT / directory / 'result.json')
        assert capture_plan['collectOnly'] and not capture_plan['workingTreeDirty']
        assert len(capture_plan['roles']) == 1 and capture_plan['roles'][0]['role'] == 'CODE'
        assert capture_plan['profile'] == 'full' and capture_plan['repeats'] == 3
        assert len(capture_plan['roles'][0]['tasks']) == 7
        assert capture_result['status'] == 'COLLECTION_COMPLETE'
        assert capture_result['planSha256'] == capture_plan['sha256']
        assert capture_result['decisionAuthority'] is False and len(capture_result['attempts']) == 21
        assert len(capture_result['capturePreflights']) == 7
        assert all(p['ready'] for p in capture_result['capturePreflights'])
        assert all(a['captureStatus'] == 'CAPTURED' and a['gradingStatus'] == 'NOT_GRADED'
                   and 'score' not in a for a in capture_result['attempts'])
        identity = capture_result['artifacts']['model']
        assert identity['modelName'] == capture_plan['model']
        assert all(a['artifact']['digestSha256'] == identity['digestSha256']
                   for a in capture_result['attempts'])
        code_captures[identity['modelName']] = (capture_plan, capture_result)
        code_sources[identity['modelName']] = {'planPath': str(CODE_ROOT / directory / 'plan.json'),
            'planFileSha256': plan_file_sha, 'resultPath': str(CODE_ROOT / directory / 'result.json'),
            'resultFileSha256': result_file_sha, 'digestSha256': identity['digestSha256']}
    assert len({p['roles'][0]['contractSha256'] for p, _ in code_captures.values()}) == 1
    code_replay, code_replay_sha = read(CODE_ROOT / 'technical-replay.json')
    assert code_replay['status'] == 'EXECUTABLE_COMPONENT_REPLAY_COMPLETE'
    assert code_replay['expectedAttempts'] == len(code_replay['items']) == 42
    assert code_replay['fullOracleAccepted'] is False and code_replay['decisionAuthority'] is False
    assert all(item['assessment']['score'] is None for item in code_replay['items'])
    plan = chat_wrapper['plan']
    assert packet['status'] == 'DEVELOPMENT_BLIND_REVIEW' and packet['decisionAuthority'] is False
    assert len(packet['cases']) == 312 and len(fixture['tasks']) >= 32
    assert len(plan['models']) == 10 and len(plan['tasks']) == 40 and plan['repeats'] == 3
    assert chat_summary['plannedConversations'] == 1200 and chat_summary['finishedConversations'] == 1200
    assert chat_summary['capturedConversations'] == 1196
    task_map = {task['name']: task for task in fixture['tasks'] if task['role'] in ('D1','D2','R1','R2')}
    assert len(task_map) == 32
    grouped = collections.defaultdict(list)
    for case in packet['cases']:
        task = task_map[case['task']]
        assert case['role'] == task['role']
        assert case['question'] == task['prompt']
        assert case['rubric'] == task['reference']['criteria']
        grouped[(case['role'], case['task'])].append(case)
    assert set(grouped) == {(t['role'], t['name']) for t in task_map.values()}
    selected = {(s['model'], s['role']): s for s in campaign['selected']}
    assert len(selected) == 16
    current_tags = {m['name']: m['digest'] for m in get_json('http://127.0.0.1:11434/api/tags')['models']}
    models = []
    for item in plan['models']:
        name, artifact = item['name'], item['artifact']
        digest = artifact['digestSha256']
        assert current_tags.get(name) == digest, f'ARTIFACT_DRIFT:{name}'
        request = urllib.request.Request('http://127.0.0.1:11434/api/show',
            data=json.dumps({'model':name}).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request, timeout=5) as response:
            capabilities = json.load(response).get('capabilities', [])
        models.append({'model':name, 'digestSha256':digest,
            'providerVersion':artifact['providerVersion'], 'capabilities':sorted(capabilities)})
    assert len({m['digestSha256'] for m in models}) == 10
    cells = []
    for model in models:
        for role in ROLES:
            row = {'model':model['model'], 'digestSha256':model['digestSha256'], 'role':role,
                   'status':None, 'source':None, 'runId':None, 'suiteContractSha256':None,
                   'currentSuiteContractSha256':None, 'inputOptionsSha256':None,
                   'responseCount':0, 'plannedResponseCount':0, 'productionCanaryDialogs':0, 'productionCanaryPlanSha256':None, 'graded':False, 'decisionAuthority':False, 'reason':None}
            run = selected.get((model['model'],role))
            if run:
                assert run['digestSha256'] == model['digestSha256']
                row.update(status='SEBRÁNO',source='isolated-20260925',runId=run['runId'],
                    suiteContractSha256=run['contractSha256'],
                    currentSuiteContractSha256=run['currentContractSha256'],
                    inputOptionsSha256=campaign['roles'][role]['currentInputOptionsSha256'],
                    responseCount=run['responses'],
                    reason='Exact raw answers; semantic review pending' if role != 'VISION'
                      else 'Technical score only; deterministic repeats identical, no accepted rank-check')
            elif role == 'VISION' and 'vision' not in model['capabilities']:
                row.update(status='N/A',source='Ollama capabilities for exact digest',
                    reason='Exact installed artifact has no vision capability')
            elif role == 'CODE' and model['model'] in code_captures:
                capture_plan, capture_result = code_captures[model['model']]
                assert capture_result['artifacts']['model']['digestSha256'] == model['digestSha256']
                row.update(status='SEBRÁNO',source='code-capture-20260925',
                    runId=capture_plan['sha256'],
                    suiteContractSha256=capture_plan['roles'][0]['contractSha256'],
                    responseCount=21,plannedResponseCount=21,gradeStatus='BLOKOVÁNO_ORACLE',
                    reason='One-shot raw CODE answers and separate executable replay; no repair loop or accepted full score')
            elif role == 'CODE':
                row.update(status='CHYBÍ',source='CODE capture inventory',gradeStatus='BLOKOVÁNO_ORACLE',
                    reason='No current raw CODE capture for this artifact; executable capture is available, full semantic scoring remains blocked')
            elif role == 'CHAT':
                row.update(status='ČÁSTEČNÉ',source='chat-panel-20260923',
                    suiteContractSha256=plan['fixtureSha256'],responseCount=captured_by_model[model['model']],plannedResponseCount=120,
                    productionCanaryDialogs=4 if model['model'] in canary_models else 0,
                    productionCanaryPlanSha256=canary_plan['planSha256'] if model['model'] in canary_models else None,
                    reason=('120 dialogues under draft profile plus 4 production-profile canary dialogues; full 40-task production profile missing'
                        if model['model'] in canary_models else '120 dialogues under draft profile; production-profile capture missing'))
            else:
                row.update(status='CHYBÍ',source='isolated-20260925',
                    reason='No exact comparable capture for this model and role')
            cells.append(row)
    # VISION/CODE/CHAT have their own suites.  This audit concerns only the D/R
    # task set, and does not call author probes an independent acceptance.
    tasks = []
    for task in fixture['tasks']:
        if task['name'] not in task_map: continue
        cases = grouped[(task['role'],task['name'])]
        controls = task['reference']['controls']
        assert {'keyword-stuffing','negated-facts','confident-wrong'} <= set(controls)
        assert task['reference']['gold'] and task['reference']['alternative']
        assert len(cases) in (9,12)
        tasks.append({'role':task['role'],'task':task['name'],
            'language':task['language'],'independenceGroup':task['independenceGroup'],
            'purpose':task['reference']['criteria'][0],
            'sourceRevision':task['provenance']['revision'],
            'sourcePath':task['provenance']['path'],
            'sourceFileSha256':task['provenance']['fileSha256'],
            'publicContextChars':len(task['prompt']),
            'promptSha256':sha(task['prompt'].encode()),
            'rubricSha256':sha(json.dumps(task['reference']['criteria'],ensure_ascii=False).encode()),
            'criteria':len(task['reference']['criteria']),'capturedResponses':len(cases),
            'goldAndAlternativePresent':True,'authorNegativeControls':controls,
            'sourceFidelity':'GIT_EXCERPT_MATCHES',
            'contextSufficiency':'REQUIRES_INDEPENDENT_REVIEW',
            'specificContextIssue':('PREVIOUS_MODEL_NULL_SCHEMA_OMITTED'
                if task['name'].endswith('_model_cleanup') else None),
            'oracleAcceptance':'AUTHOR_PROBES_ONLY'})
    # Select two whole scenario groups per role and one repetition per label.
    # Each role therefore contributes a comparison of answers to the SAME task.
    sample = []
    for role in ('D1','D2','R1','R2'):
        names = sorted(t['name'] for t in task_map.values() if t['role']==role)
        chosen = sorted(names,key=lambda task:rank(packet_sha,'task',role,task))[:2]
        for task in chosen:
            labels = sorted({c['label'] for c in grouped[(role,task)]})
            for label in labels:
                options = [c for c in grouped[(role,task)] if c['label']==label]
                assert len(options)==3 and sorted(c['repeat'] for c in options)==[1,2,3]
                case = min(options,key=lambda c:rank(packet_sha,'repeat',role,task,label,str(c['repeat'])))
                sample.append({'id':case['id'],'role':role,'task':task,
                    'label':label,'repeat':case['repeat']})
    assert len(sample)==26 and len({c['id'] for c in sample})==26
    codex_sample, codex_sample_sha = read(CODEX_SAMPLE)
    assert codex_sample['packetSha256'] == packet_sha and not codex_sample['decisionAuthority']
    assert {c['id'] for c in codex_sample['items']} == {c['id'] for c in sample}
    assert sum(c['status'] == 'CODEX_PRELIMINARY_GRADED' for c in codex_sample['items']) == 23
    assert sum(c['status'] == 'TASK_ISSUE_NO_AGGREGATE_GRADE' for c in codex_sample['items']) == 3
    codex_r2, codex_r2_sha = read(CODEX_R2)
    assert codex_r2['packetSha256'] == packet_sha and codex_r2['decisionAuthority'] is False
    r2_packet = {c['id']:c for c in packet['cases'] if c['role'] == 'R2'}
    assert len(r2_packet) == 72 and {c['id'] for c in codex_r2['cases']} == set(r2_packet)
    assert all(c['task'] == r2_packet[c['id']]['task'] and
        c['label'] == r2_packet[c['id']]['label'] and
        c['repeat'] == r2_packet[c['id']]['repeat'] for c in codex_r2['cases'])
    assert codex_r2['summary'] == {'responses':72,'graded':63,'taskIssue':9}
    result={'schemaVersion':1,'status':'STEP3_PREPARATION_NO_ACCEPTED_GRADES',
        'decisionAuthority':False,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
        'sources':{'packet':{'path':str(PACKET),'sha256':packet_sha},
            'campaign':{'path':str(CAMPAIGN),'sha256':campaign_sha},
            'tasks':{'path':str(TASKS),'sha256':fixture_sha},
            'semanticSourceAudit':{'path':str(SEMANTIC_AUDIT),'sha256':semantic_audit_sha},
            'codexPresampledReview':{'path':str(CODEX_SAMPLE),'sha256':codex_sample_sha,
                'graded':23,'taskIssue':3,'decisionAuthority':False},
            'codexR2DevelopmentReview':{'path':str(CODEX_R2),'sha256':codex_r2_sha,
                'graded':63,'taskIssue':9,'decisionAuthority':False},
            'chatPlan':{'path':str(CHAT_PLAN),'sha256':chat_plan_sha,
                        'sealedPlanSha256':chat_wrapper['sha256']},
            'chatSummary':{'path':str(CHAT_SUMMARY),'sha256':chat_summary_sha},
            'chatCaptureIndex':{'reviewSha256':chat_review_sha,'identityKeySha256':chat_key_sha,
                'note':'Key used only to count CAPTURED items by model; grades and responses not read'},
            'codeCapture':{'runs':code_sources,'technicalReplayPath':str(CODE_ROOT / 'technical-replay.json'),
                'technicalReplaySha256':code_replay_sha,'fullOracleAccepted':False},
            'productionChatCanary':{'planPath':str(CANARY_RUN / 'plan.json'),
                'planFileSha256':canary_plan_file_sha,'sealedPlanSha256':canary_plan['planSha256'],
                'resultPath':str(CANARY_RUN / 'result.json'),'resultSha256':canary_result_sha}},
        'models':models,'cells':cells,'taskAudit':tasks,'presampledOperatorCases':sample,
        'reviewScope':{'semanticPacketCases':312,'semanticCriteria':sum(len(c['rubric']) for c in packet['cases']),
            'packetModelLabelsByRole':{r:dict(collections.Counter(c['label'] for c in packet['cases'] if c['role']==r))
                for r in ('D1','D2','R1','R2')},
            'blindnessLimitation':'Prior exposure to identified answers/grades must be disclosed by each reviewer; anonymity alone does not prove independence.',
            'humanReference':'NOT_CREATED','opusReview':'NOT_IMPORTED','codexReview':'R2_72_OF_72_REVIEWED_63_PRELIMINARY_GRADES_9_TASK_ISSUES; OTHER_ROLES_PRESAMPLED_ONLY'},
        'gates':{'D_R':'RAW_CAPTURE_COMPARABLE_BUT_GRADER_NOT_ACCEPTED',
            'CODE':'RAW_TWO_ARTIFACTS_TECHNICAL_REPLAY_COMPLETE_FULL_ORACLE_BLOCKED','CHAT':'PRODUCTION_CANARY_4_OF_40_FOR_2_MODELS_GRADING_OPEN',
            'VISION':'TECHNICAL_EXPLORATION_ONLY','roleDecision':'NO_GO'}}
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    symbol={'N/A':'N/A','CHYBÍ':'CHYBÍ','SEBRÁNO':'SEBRÁNO','ČÁSTEČNÉ':'ČÁSTEČNÉ','BLOKOVÁNO':'BLOKOVÁNO'}
    by={(c['model'],c['role']):c for c in cells}
    lines=['# GPU hunt: podklad pro krok 3','',
      '25. 9. 2026 · **bez rozhodovací autority a bez přijatých sémantických známek**','',
      'Tento přehled váže stav každé buňky na přesný digest a zdroj. `SEBRÁNO` znamená pouze úplný syrový sběr v dané sadě, nikoli přijaté skóre. `ČÁSTEČNÉ` u CHAT znamená vývojový panel; pouze dva modely mají navíc čtyři dialogy ve skutečném produkčním profilu. U CODE dva modely nově mají plný syrový jednozprávový sběr; zbylým modelům tento sběr `CHYBÍ`. **Známka CODE je u všech blokována významovým orákulem.** Technický replay není celkové skóre ani průchod C3 opravnou smyčkou. `N/A` u VISION je doložené nepřítomností capability `vision` na přesném lokálním artefaktu.','',
      f'Kanonický [formulář]({PACKET.parent / "review.html"}) má 312 celých odpovědí a 840 kritérií; packet SHA256 `{packet_sha}`. Starší oddělené packety po 120 jsou stažené ze srovnávacího hodnocení. Níže předvolený náhodný vzorek vznikl z tohoto SHA **před otevřením nových známek**.','',
      '| Model (digest prefix) | D1 | D2 | CODE | R1 | R2 | CHAT | VISION |','|---|---|---|---|---|---|---|---|']
    for m in models:
        lines.append('| '+m['model']+' (`'+m['digestSha256'][:12]+'`) | '+' | '.join(symbol[by[(m['model'],r)]['status']] for r in ROLES)+' |')
    lines.extend(['','Podrobné [přejímací brány všech sedmi sad](2026-09-25-HUNT-SUITE-ACCEPTANCE-GATES.md) odlišují dvoumodelový pilot od přijaté sady.','','## Podklad a omezení sad','',
      '- D1/D2/R1/R2: 8 historických skupin na roli, všech 312 odpovědí přesně odpovídá aktuálnímu veřejnému zadání a rubrice. 32 úloh má autora gold, alternativu a negativní sondy; 8 476 předaných řádků bylo ověřeno proti historickým souborům. [Předběžná věcná kontrola](2026-09-25-HUNT-DR-CONTEXT-REVIEW.md) našla chybějící DDL u `model_cleanup` ve všech čtyřech rolích; **nezávislá přejímka dostatku kontextu a významového hodnocení stále chybí**. Zadání jsou aktuálně jen anglicky. Počet opakování nepřidává nezávislé případy. Přesné SHA, původ a počet kritérií každé úlohy jsou ve [strojovém podkladu](evidence/2026-09-25-hunt-step3-readiness.json).',
      '- CODE: [nový oddělený sběr](2026-09-25-HUNT-CODE-CAPTURE.md) qwen3.8 a qwen3.5 obsahuje 42/42 syrových odpovědí (7 úloh × 3 opakování na model). Technický replay je samostatný. Aktivní finální orákulum stále přijme věcný rozpor a odmítne správnou parafrázi; všechny plné známky jsou `null`. Jednozprávová sada neobsahuje C3 pracovní opravné iterace.',
      '- CHAT: pečetěný plán má 10 modelů × 40 dialogů × 3 pokusy. Všech 1 200 pokusů skončilo, 1 196 bylo zachyceno; čtyři skončily výstupním limitem nebo transportní chybou. Strojová matice uvádí pro každý model skutečně zachycených 119 či 120 z plánovaných 120, ne fiktivní úplnost. Samostatný [produkční canary](2026-09-25-HUNT-CHAT-PRODUCTION-CANARY.md) zachytil 4 ze 40 úloh pro qwen3.8 a qwen3.5 se skutečným promptem a shodným kontextem; ostatní modely ani celá sada takto pokryté nejsou. Druhý nezávislý posudek chybí.',
      '- VISION: 3 × 23 úloh bylo sebráno, ale tři opakování při `temperature: 0` jsou vždy stejná. U dalšího měření stačí jedna deterministická odpověď; chybějící vision-capable modely jsou v tabulce `CHYBÍ`, ne `N/A`.','',
      '## Předem vybraný vzorek pro operátora','',
      'Pro každou D/R roli jsou vybrány dvě celé historické úlohy a jedna náhodně určená odpověď každého anonymního modelu na **tutéž** úlohu. Jde o 26 odpovědí; výběr nečetl známky. K tomu po příchodu obou posudků přibudou všechny neshody od 0,15 po kritériích, nízká jistota nahlášená hodnotitelem a kritická selhání. [Generátor fronty pro operátora](../../scripts/manual/build-hunt-operator-queue.mjs) zachová celé zadání, odpověď i oba konkrétní důvody; pokud hodnotitelé nedodají explicitní příznaky jistoty a kritických selhání, výsledek to označí jako neúplné.','',
      '| Role | Úloha | Odpověď | ID |','|---|---|---|---|'])
    for c in sample:lines.append(f"| {c['role']} | `{c['task']}` | {c['label']}/{c['repeat']} | `{c['id']}` |")
    lines.extend(['','[Čitelná stránka pro revizi předvoleného vzorku](2026-09-25-HUNT-STEP3-OPERATOR-PRESAMPLE.html) ukazuje celé zadání, odpověď a známku u anonymního kandidáta. [Strojový posudek 26 odpovědí](evidence/2026-09-25-hunt-codex-presampled-review.json) má 23 předběžných známek po kritériích a 3 bez souhrnné známky kvůli vadě zadání `model_cleanup`. Codex dále prošel [celou roli R2](evidence/2026-09-25-hunt-codex-r2-development-review.json): 63/72 předběžných známek a 9 označených vad zadání. Ostatní tři role zatím mají jen předvolený vzorek. To není úplná reference ani přijaté známky; známky Opusu při tomto čtení nebyly otevřeny.','','## Krok 3 – přejímací postup','',
      '1. Codex a Opus hodnotí **stejný úplný packet** odděleně, po kritériích s konkrétním důvodem a citací místa v odpovědi. Jakoukoli předchozí expozici identit nebo známek oba výslovně uvedou. Nevyplněná známka není nula.',
      '2. Každý posudek se zmrazí jako samostatný soubor navázaný na SHA packetu. [Validátor](../../scripts/verify-hunt-blind-review.mjs) kontroluje úplnost 312 řádků / 840 kritérií a porovnává celé setiny. `null` povoluje jen s konkrétním důvodem `TASK_ISSUE:`; nesmí se počítat jako nula ani jako shoda. Původní známky nepřepisuje.',
      '3. Operátor dostane tento předvolený vzorek, všechny spory od 0,15 po kritériích, kritická selhání a explicitně označenou nízkou jistotu. Rozsudek bude samostatná vrstva s vlastním původem; nikdy nezmění syrové odpovědi nebo posudky.',
      '4. Prozatímní procentní matice vznikne **až z rozsouzených skutečně hodnocených buněk** a nese původ každého skóre. Kde je CODE plné hodnocení zablokované nebo CHAT neporovnatelný s produkcí, nesmí být procento vykládáno jako výběr modelu.','',
      'Před GO stále zbývá nezávisle přijmout hodnotitele/orákula a ověřit pořadí na čerstvých provozních případech. Tato příprava neaktivuje model, timer ani mazání.',''])
    DOC.write_text('\n'.join(lines))
    print(json.dumps({'status':result['status'],'models':len(models),'cells':len(cells),
        'tasks':len(tasks),'sample':len(sample),'packetSha256':packet_sha,
        'output':str(DOC)},ensure_ascii=False))

if __name__ == '__main__':main()
