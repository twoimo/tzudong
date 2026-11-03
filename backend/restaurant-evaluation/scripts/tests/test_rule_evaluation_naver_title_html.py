import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / 'backend/restaurant-evaluation/scripts/10-rule-evaluation.py'
sys.path.insert(0, str(ROOT / 'backend'))
spec = importlib.util.spec_from_file_location('rule_evaluation_naver_title_html', SCRIPT)
rule = importlib.util.module_from_spec(spec)
assert spec and spec.loader
# This provider-boundary fixture needs no local credentials or dotenv loading.
with patch('utils.runtime_paths.load_backend_env'):
    spec.loader.exec_module(rule)


class NaverTitleHtmlTests(unittest.TestCase):
    def search(self, title, **fields):
        item = {'title': title, 'address': '서울특별시 마포구 숭문길 24',
                'roadAddress': '', 'mapx': '', 'mapy': '', **fields}
        original = copy.deepcopy(item)
        response = Mock(content=b'fixture')
        response.json.return_value = {'items': [item]}
        with patch.object(rule, 'provider_get', return_value=response) as provider:
            records = rule._naver_local_search_uncached('synthetic query')
        provider.assert_called_once()
        response.raise_for_status.assert_called_once_with()
        self.assertEqual(item, original)
        self.assertEqual(len(records), 1)
        return records[0]

    def test_provider_bold_ampersand_nbsp_and_numeric_entities(self):
        for raw, expected in [
            ('<b>돈</b>&amp;<b>까</b>', '돈&까'),
            ('  <b>돈</b>&nbsp; &amp;\u00a0<b>까</b>\t ', '돈 & 까'),
            ('돈&#38;까', '돈&까'),
            ('돈&#x26;까', '돈&까'),
            ('&#46024;&#38;&#44620;', '돈&까'),
            ('<b>돈</b>&#160;&#x26;&#xA0;<b>까</b>', '돈 & 까'),
            ('<b>C++</b> &amp; R&amp;D &quot;돈/까&quot; &#39;본점&#39;',
             'C++ & R&D "돈/까" \'본점\''),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(self.search(raw)['title'], expected)

    def test_plain_business_characters_are_unchanged_and_idempotent(self):
        for literal in ['돈 & 까', 'C++ & R&D 돈/까 #1 (본점)',
                        'A<B> 돈<3 까>2', '돈/까 "본점" \'별관\'', '돈&까']:
            with self.subTest(literal=literal):
                first = self.search(literal)['title']
                self.assertEqual(first, literal)
                self.assertEqual(self.search(first)['title'], literal)

    def test_plain_whitespace_normalizes_without_renaming(self):
        self.assertEqual(self.search('  돈\t &\n 까\u00a0 본점  ')['title'], '돈 & 까 본점')

    def test_nested_entity_is_decoded_once_and_comparators_do_not_decode_again(self):
        candidate = self.search('돈&amp;amp;까')['title']
        self.assertEqual(candidate, '돈&amp;까')
        self.assertEqual(rule._normalize_name_key(candidate), '돈amp까')
        self.assertFalse(rule._provider_names_compatible('돈 & 까', candidate))

    def test_encoded_literal_bold_characters_survive_strip_then_decode_order(self):
        self.assertEqual(self.search('&lt;b&gt;돈&amp;까&lt;/b&gt;')['title'], '<b>돈&까</b>')

    def test_title_cleanup_does_not_rewrite_other_provider_fields(self):
        candidate = self.search('<b>돈</b>&amp;까', address='공개 주소 &amp; 별관',
                                roadAddress='공개 도로명 &nbsp; 1', mapx='1270000000', mapy='370000000')
        self.assertEqual(candidate, {'title': '돈&까', 'address': '공개 주소 &amp; 별관',
                                    'roadAddress': '공개 도로명 &nbsp; 1',
                                    'mapx': '1270000000', 'mapy': '370000000'})

    def test_decoded_name_reaches_existing_identity_and_location_evidence_checks(self):
        candidate = self.search('<b>돈</b>&amp;<b>까</b>')
        self.assertTrue(rule._provider_names_compatible('돈 & 까', candidate['title']))
        self.assertFalse(rule._provider_names_compatible('김밥천국', candidate['title']))
        with patch.object(rule, 'ncp_geocode_addresses', return_value=None):
            result = rule.evaluate_with_unique_naver_title_match(
                '돈 & 까', '서울특별시 마포구', [candidate], None, None)
        self.assertIsNotNone(result)
        self.assertEqual(result['matched_name'], '돈&까')
        self.assertEqual(result['naver_name'], '돈&까')
        self.assertEqual(result['evidence_families'],
                         [rule.EVIDENCE_PROVIDER_CANDIDATE, rule.EVIDENCE_SOURCE_GEO])

    def test_decoding_alone_does_not_supply_independent_location_evidence(self):
        candidate = self.search('<b>돈</b>&amp;까')
        with patch.object(rule, 'ncp_geocode_addresses', return_value=None):
            result = rule.evaluate_with_unique_naver_title_match('돈 & 까', '', [candidate], None, None)
        self.assertIsNone(result)


if __name__ == '__main__':
    unittest.main()
