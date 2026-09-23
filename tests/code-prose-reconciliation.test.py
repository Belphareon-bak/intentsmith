import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reconcile = load('reconcile', 'scripts/manual/reconcile-code-prose-review.py')
prepare = load('prepare', 'scripts/manual/prepare-code-prose-review.py')
fixtures = load('fixtures', 'tests/code-prose-review.test.py')


def fixture():
    answers, replay = fixtures.fixture()
    packet, bindings = prepare.prepare(answers, replay)
    review = prepare.template(packet)
    review.update(reviewer='Test reviewer', priorExposureDeclared='Already saw original findings')
    for item in review['items']:
        for axis in item['axes']:
            axis.update(score=1, reason='Test fixture reason', evidence='O01: Observed text')
    author = {'decisionAuthority': False, 'calibrationEvidence': False, 'source': {'sha256': 'replay-hash'},
              'items': [{'id': row['id'], 'responseSha256': row['responseSha256'],
                         'criteria': [{'id': axis, 'score': 1} for axis in reconcile.AXES.values()]}
                        for row in answers['items']]}
    custody = {'packetId': packet['packetId'], 'identities': bindings, 'replaySha256': 'replay-hash'}
    return dict(packet=packet, custody=custody, review=review, author=author)


class ReconciliationTest(unittest.TestCase):
    def test_agreement_does_not_promote_draft_or_create_calibration(self):
        data = fixture()
        original = copy.deepcopy(data)
        r = reconcile.reconcile(**data)
        self.assertEqual(r['summary']['agree'], 60)
        for field in ['decisionAuthority', 'productionImported', 'calibrationEvidence', 'independentAgreement', 'freshHoldout']:
            self.assertFalse(r[field])
        self.assertEqual(r['qualityObservations']['missingApi'], 240)
        self.assertEqual(r['qualityObservations']['correctApiPresent'], 0)
        self.assertEqual(data, original)

    def test_packet_and_author_source_identity_are_checked(self):
        for key in ['packet', 'author']:
            d = fixture()
            if key == 'packet':
                d['review']['packetId'] = 'wrong-packet'
            else:
                d['author']['source']['sha256'] = 'other-replay'
            with self.assertRaises(ValueError):
                reconcile.reconcile(**d)

    def test_duplicate_and_missing_rows_are_rejected(self):
        for action in ['duplicate', 'missing']:
            d = fixture()
            if action == 'duplicate':
                d['review']['items'][1] = copy.deepcopy(d['review']['items'][0])
            else:
                d['review']['items'].pop()
            with self.assertRaises(ValueError):
                reconcile.reconcile(**d)

    def test_changed_answer_is_rejected(self):
        d = fixture()
        d['packet']['items'][0]['response'] = 'Changed response'
        with self.assertRaisesRegex(ValueError, 'PROVENANCE'):
            reconcile.reconcile(**d)

    def test_bad_score_or_unsupported_authority_is_rejected(self):
        for value in [True, 1.1, float('nan')]:
            d = fixture()
            d['review']['items'][0]['axes'][0]['score'] = value
            with self.assertRaisesRegex(ValueError, 'SCORE'):
                reconcile.reconcile(**d)
        d = fixture()
        d['review']['decisionAuthority'] = True
        with self.assertRaisesRegex(ValueError, 'CONTRACT'):
            reconcile.reconcile(**d)

    def test_disagreement_and_missing_score_remain_visible(self):
        d = fixture()
        d['review']['items'][0]['axes'][0]['score'] = .5
        d['review']['items'][1]['axes'][0]['score'] = None
        r = reconcile.reconcile(**d)
        self.assertEqual(r['summary']['agree'], 58)
        self.assertEqual(r['summary']['missing'], 1)
        self.assertEqual(r['summary']['distributions']['confidence_explanation'], {'0.5': 1, 'null': 1, '1': 28})

    def test_quote_lookup_does_not_assign_a_semantic_grade(self):
        d = fixture()
        d['review']['items'][0]['axes'][0]['evidence'] = 'A paraphrase, not an exact quotation'
        r = reconcile.reconcile(**d)
        self.assertEqual(r['summary']['literalQuoteChecksPassed'], 59)
        self.assertEqual(r['summary']['agree'], 60)
        self.assertFalse(r['qualityObservations']['proseAutomaticallyGraded'])

    def test_missing_reason_or_exposure_is_not_silently_accepted(self):
        for field in ['reason', 'exposure']:
            d = fixture()
            if field == 'reason':
                d['review']['items'][0]['axes'][0]['reason'] = ''
            else:
                d['review']['priorExposureDeclared'] = ''
            with self.assertRaises(ValueError):
                reconcile.reconcile(**d)


if __name__ == '__main__':
    unittest.main()
