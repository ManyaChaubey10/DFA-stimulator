import itertools
import unittest

from app.automata import RegexError, minimize_dfa, simulate
from app.main import NaturalLanguageRequest, generate_from_description
from app.natural_language import (
    NonRegularLanguageError, build_dfa_from_description, compile_ast, interpret_description, validate_ast,
)


class NaturalLanguageDfaTests(unittest.TestCase):
    def test_api_route_returns_original_and_minimized_dfas(self):
        response = generate_from_description(NaturalLanguageRequest(
            alphabet=['0', '1'], description='Binary strings ending with 01'
        ))
        self.assertIn('minimized_dfa', response)
        self.assertEqual(response['alphabet'], ['0', '1'])
        self.assertEqual(response['description'], 'Binary strings ending with 01')
        self.assertEqual(response['minimized_dfa']['description'], response['description'])
        self.assertTrue(simulate(response, '101')['accepted'])
        self.assertTrue(simulate(response['minimized_dfa'], '101')['accepted'])

    def check_language(self, description, expected):
        dfa = build_dfa_from_description(description, ['0', '1'])
        minimized = minimize_dfa(dfa)
        for machine in (dfa, minimized):
            for state in machine['states']:
                self.assertEqual(set(machine['transitions'][state]), set(machine['alphabet']))
            for length in range(6):
                for chars in itertools.product('01', repeat=length):
                    value = ''.join(chars)
                    with self.subTest(description=description, value=value):
                        self.assertEqual(simulate(machine, value)['accepted'], expected(value))
        return dfa

    def test_even_number_of_zeros_including_empty_string(self):
        self.check_language('Even number of 0s', lambda value: value.count('0') % 2 == 0)

    def test_odd_number_of_ones_and_empty_string_rejected(self):
        self.check_language('Odd number of 1s', lambda value: value.count('1') % 2 == 1)

    def test_suffix_pattern(self):
        self.check_language('Binary strings ending with 01', lambda value: value.endswith('01'))

    def test_contained_substring(self):
        self.check_language('Strings containing 101', lambda value: '101' in value)

    def test_forbidden_consecutive_symbol(self):
        self.check_language('No consecutive 1s', lambda value: '11' not in value)

    def test_combined_parity_conditions(self):
        self.check_language(
            'Even number of 0s and odd number of 1s',
            lambda value: value.count('0') % 2 == 0 and value.count('1') % 2 == 1,
        )

    def test_combined_parity_and_substring_condition(self):
        self.check_language(
            'Even number of 0s and strings containing 101',
            lambda value: value.count('0') % 2 == 0 and '101' in value,
        )

    def test_explicit_forbidden_substring(self):
        self.check_language('Strings without 101', lambda value: '101' not in value)

    def test_prefix_pattern(self):
        self.check_language('Strings starting with 10', lambda value: value.startswith('10'))

    def test_all_generators_reject_symbols_outside_alphabet(self):
        for description in (
            'Even number of 0s', 'Odd number of 1s', 'Binary strings ending with 01',
            'Strings containing 101', 'No consecutive 1s',
            'Strings without 101',
            'Even number of 0s and odd number of 1s', 'Strings starting with 10',
        ):
            dfa = build_dfa_from_description(description, ['0', '1'])
            with self.subTest(description=description), self.assertRaises(RegexError):
                simulate(dfa, '2')

    def test_unsupported_or_out_of_alphabet_descriptions_are_helpful_errors(self):
        for description in ('approximately half zeros', 'Strings containing 2'):
            with self.subTest(description=description), self.assertRaisesRegex(RegexError, 'couldn.t interpret|input alphabet'):
                build_dfa_from_description(description, ['0', '1'])

    def test_extended_regular_language_examples(self):
        cases = [
            ('Second symbol from the right is 1', lambda s: len(s) >= 2 and s[-2] == '1'),
            ('Third symbol from the left is 0', lambda s: len(s) >= 3 and s[2] == '0'),
            ('Strings containing exactly three 1s', lambda s: s.count('1') == 3),
            ('Strings starting with 0 and ending with 11', lambda s: s.startswith('0') and s.endswith('11')),
            ('Strings containing an even number of 0s and an odd number of 1s', lambda s: s.count('0')%2==0 and s.count('1')%2==1),
            ('Strings whose length is divisible by 3', lambda s: len(s)%3==0),
            ('Strings containing 101 but not 000', lambda s: '101' in s and '000' not in s),
            ('Strings whose second-to-last symbol is 1 and whose number of 0s is even', lambda s: len(s)>=2 and s[-2]=='1' and s.count('0')%2==0),
        ]
        for description, predicate in cases:
            dfa=self.check_language(description, predicate)
            with self.subTest(description=description, invalid_symbol=True), self.assertRaises(RegexError):
                simulate(dfa,'2')

    def test_boolean_or_and_complement_compile_from_ast(self):
        alphabet=['0','1']
        ast={'op':'OR','args':[{'op':'starts_with','pattern':'0'},{'op':'ends_with','pattern':'1'}]}
        dfa=compile_ast(ast,alphabet)
        for length in range(6):
            for chars in itertools.product('01',repeat=length):
                value=''.join(chars)
                self.assertEqual(simulate(dfa,value)['accepted'],value.startswith('0') or value.endswith('1'))
        not_ast={'op':'NOT','arg':{'op':'contains','pattern':'101'}}
        complement=compile_ast(not_ast,alphabet)
        for length in range(6):
            for chars in itertools.product('01',repeat=length):
                value=''.join(chars)
                self.assertEqual(simulate(complement,value)['accepted'],'101' not in value)

    def test_ast_validation_rejects_unknown_operations_and_extra_fields(self):
        for ast in ({'op':'run_python','code':'...'}, {'op':'contains','pattern':'1','transitions':{}}):
            with self.subTest(ast=ast), self.assertRaises(RegexError):
                validate_ast(ast,['0','1'])
        with self.assertRaisesRegex(RegexError, 'Clarification needed'):
            validate_ast({'op':'clarify','question':'Which interpretation did you intend?'},['0','1'])

    def test_deterministic_interpreter_does_not_need_credentials(self):
        ast, source=interpret_description('length divisible by 3',['0','1'])
        self.assertEqual(source,'deterministic')
        self.assertEqual(ast,{'op':'length_mod','modulus':3,'remainder':0})

    def test_explicit_equal_block_counts_are_identified_as_non_regular(self):
        for description in ('{a^n b^n | n >= 0}', 'equal number of a followed by b'):
            with self.subTest(description=description), self.assertRaisesRegex(NonRegularLanguageError, 'known non-regular'):
                interpret_description(description, ['a', 'b'])


if __name__ == '__main__':
    unittest.main()
