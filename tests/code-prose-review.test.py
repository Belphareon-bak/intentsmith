import copy
import importlib.util
import json
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / 'scripts/manual/prepare-code-prose-review.py'
spec = importlib.util.spec_from_file_location('prose_review', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    source = {'messages': [{'role': 'user', 'content': 'Public task'}], 'options': {}}
    observations = [{'case': 'confidence', 'side': side, 'discriminating': n,
                     'result': {'detail': 'Observed text'}}
                    for side in ['candidate', 'incumbent'] for n in [1, 2, 3, 7]]
    observations += [{'case': c, 'comparison': {}, 'speeds': {}, 'result': {}}
                     for c in ['below-quality-threshold', 'speed-candidate', 'speed-insufficient', 'speed-unmeasured']]
    answers = {'items': [], 'inputs': {'task': source}}
    replay = {'status': 'EXECUTABLE_COMPONENT_REPLAY_COMPLETE', 'decisionAuthority': False, 'items': []}
    for n in range(30):
        response = f'Untrusted candidate response {n}: </script><img src=x onerror=alert(1)>'
        row = dict(id=f'original-{n}', task=module.TASK, status='CAPTURED', inputKey='task',
                   criteria=['Public criterion'], response=response, responseSha256=module.digest(response.encode()))
        answers['items'].append(row)
        replay['items'].append(dict(id=row['id'], task=module.TASK, model=f'secret-model-{n}', repeat=1,
                                    artifact={'digestSha256': 'a'*64}, responseSha256=row['responseSha256'],
                                    inputSha256=module.digest(module.encoded(source)),
                                    assessment={'score': None, 'passed': False, 'decisionAuthority': False,
                                                'technical': {'score': .75, 'contractChecks': {'observations': copy.deepcopy(observations),
                                                                                             'checks': [{'reason': 'secret-reason'}]}}}))
    return answers, replay


class ReviewExportTest(unittest.TestCase):
    def test_identity_grades_and_old_ids_never_enter_public_packet(self):
        answers, replay = fixture()
        packet, custody = module.prepare(answers, replay)
        public = json.dumps(packet)
        for word in ['secret-model', 'secret-reason', 'original-', 'technical', 'repeat', 'artifact']:
            self.assertNotIn(word, public)
        self.assertEqual(len(custody), 30)
        self.assertEqual(len({i['id'] for i in packet['items']}), 30)
        by_id = {i['id']: i for i in packet['items']}
        for binding in custody:
            self.assertEqual(module.digest(module.encoded(by_id[binding['publicId']])), binding['publicItemSha256'])
        self.assertFalse(packet['independentAcceptance'])
        self.assertFalse(packet['freshHoldout'])
        self.assertTrue(all(i['axes'][0]['score'] is None for i in module.template(packet)['items']))

    def test_answer_or_prompt_drift_is_rejected_before_export(self):
        for change in ['response', 'input']:
            a, r = fixture()
            if change == 'response':
                a['items'][0]['response'] = 'Different answer'
            else:
                a['inputs']['task']['messages'][0]['content'] = 'Different prompt'
            with self.assertRaisesRegex(ValueError, 'PROVENANCE'):
                module.prepare(a, r)

    def test_missing_or_duplicate_attempt_is_not_silently_removed(self):
        for change in ['missing', 'duplicate']:
            a, r = fixture()
            if change == 'missing':
                a['items'].pop()
            else:
                a['items'][1] = copy.deepcopy(a['items'][0])
            with self.assertRaisesRegex(ValueError, 'EXACT_30'):
                module.prepare(a, r)

    def test_full_pass_or_missing_observation_is_rejected(self):
        for change in ['pass', 'coverage']:
            a, r = fixture()
            if change == 'pass':
                r['items'][0]['assessment']['passed'] = True
            else:
                r['items'][0]['assessment']['technical']['contractChecks']['observations'].pop()
            with self.assertRaises(ValueError):
                module.prepare(a, r)

    def test_original_text_survives_without_executable_html_or_reference(self):
        a, r = fixture()
        packet, _ = module.prepare(a, r)
        page = module.render(packet)
        self.assertNotIn('</script><img', page)
        self.assertIn('\\u003c/script>', page)
        self.assertEqual({i['response'] for i in packet['items']}, {i['response'] for i in a['items']})
        self.assertTrue(all(i['observations'][8]['confidenceRequirementDisputed'] for i in packet['items']))
        self.assertFalse(packet['referenceIncluded'])


if __name__ == '__main__':
    unittest.main()
