import itertools
import unittest

from app.automata import (
    DfaValidationError, build_dfa, complement_dfa, difference_dfa, intersection_dfa,
    is_language_empty, minimize_dfa, reachable_states, shortest_counterexample,
    simulate, symmetric_difference_dfa, union_dfa, validate_dfa,
)


class DfaMinimizationTests(unittest.TestCase):
    def setUp(self):
        self.original = build_dfa('(0|1)*01', ['0', '1'])
        self.minimized = minimize_dfa(self.original)

    def test_generated_fourth_state_is_redundant_not_a_sink(self):
        self.assertEqual(len(self.original['states']), 4)
        self.assertEqual(self.original['transitions']['q0'], self.original['transitions']['q2'])
        self.assertNotIn('q0', self.original['accepting_states'])
        self.assertNotIn('q2', self.original['accepting_states'])
        self.assertEqual(len(self.minimized['states']), 3)

    def test_minimized_machine_is_complete(self):
        for dfa in (self.original, self.minimized):
            for state in dfa['states']:
                self.assertEqual(set(dfa['transitions'][state]), set(dfa['alphabet']))
                self.assertTrue(set(dfa['transitions'][state].values()) <= set(dfa['states']))

    def test_requested_strings_end_in_01_exactly(self):
        cases = {
            '01': True,
            '001': True,
            '101': True,
            '1101': True,
            '10': False,
            '111': False,
            '000': False,
            '010': False,
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(simulate(self.original, value)['accepted'], expected)
                self.assertEqual(simulate(self.minimized, value)['accepted'], expected)

    def test_minimization_preserves_language_exhaustively(self):
        for length in range(9):
            for symbols in itertools.product('01', repeat=length):
                value = ''.join(symbols)
                expected = value.endswith('01')
                self.assertEqual(simulate(self.original, value)['accepted'], expected)
                self.assertEqual(simulate(self.minimized, value)['accepted'], expected)


if __name__ == '__main__':
    unittest.main()


class StudentDfaValidationTests(unittest.TestCase):
    def setUp(self):
        self.dfa = {
            "states": ["s", "f"], "alphabet": ["0", "1"],
            "transitions": {"s": {"0": "s", "1": "f"}, "f": {"0": "s", "1": "f"}},
            "start_state": "s", "accepting_states": ["f"],
        }

    def test_valid_complete_dfa_is_normalized(self):
        self.assertTrue(validate_dfa(self.dfa)["complete"])

    def test_rejects_missing_transition(self):
        self.dfa["transitions"]["s"].pop("0")
        with self.assertRaisesRegex(DfaValidationError, "Missing transition"):
            validate_dfa(self.dfa)

    def test_rejects_epsilon_and_conflicting_transitions(self):
        self.dfa["transitions"]["s"]["?"] = "s"
        with self.assertRaisesRegex(DfaValidationError, "Unexpected transition"):
            validate_dfa(self.dfa)
        self.dfa["transitions"]["s"].pop("?")
        self.dfa["transitions"]["s"]["0"] = ["s", "f"]
        with self.assertRaisesRegex(DfaValidationError, "exactly one destination"):
            validate_dfa(self.dfa)

    def test_rejects_wrong_alphabet_and_unknown_destination(self):
        with self.assertRaisesRegex(DfaValidationError, "must match"):
            validate_dfa(self.dfa, ["a", "b"])
        self.dfa["transitions"]["s"]["0"] = "missing"
        with self.assertRaisesRegex(DfaValidationError, "declared state"):
            validate_dfa(self.dfa)


class DfaEquivalenceTests(unittest.TestCase):
    def test_equivalent_nonidentical_df_as_have_no_counterexample(self):
        generated = build_dfa("(0|1)*01", ["0", "1"])
        minimized = minimize_dfa(generated)
        self.assertIsNone(shortest_counterexample(generated, minimized))

    def test_returns_shortest_counterexample(self):
        reference = build_dfa("(0|1)*01", ["0", "1"])
        rejecting = {
            "states": ["r"], "alphabet": ["0", "1"],
            "transitions": {"r": {"0": "r", "1": "r"}},
            "start_state": "r", "accepting_states": [],
        }
        counterexample = shortest_counterexample(rejecting, reference)
        self.assertEqual(counterexample, "01")
        self.assertFalse(simulate(rejecting, counterexample)["accepted"])
        self.assertTrue(simulate(reference, counterexample)["accepted"])

    def test_empty_string_can_be_counterexample(self):
        left = {"states": ["a"], "alphabet": ["0"], "transitions": {"a": {"0": "a"}}, "start_state": "a", "accepting_states": ["a"]}
        right = {"states": ["b"], "alphabet": ["0"], "transitions": {"b": {"0": "b"}}, "start_state": "b", "accepting_states": []}
        self.assertEqual(shortest_counterexample(left, right), "")


class DfaBooleanOperationTests(unittest.TestCase):
    def setUp(self):
        self.ends_zero = build_dfa("(0|1)*0", ["0", "1"])
        self.ends_one = build_dfa("(0|1)*1", ["0", "1"])

    def test_union_intersection_difference_and_symmetric_difference(self):
        operations = [
            (union_dfa(self.ends_zero, self.ends_one), lambda word: word.endswith("0") or word.endswith("1")),
            (intersection_dfa(self.ends_zero, self.ends_one), lambda word: False),
            (difference_dfa(self.ends_zero, self.ends_one), lambda word: word.endswith("0")),
            (symmetric_difference_dfa(self.ends_zero, self.ends_one), lambda word: word.endswith("0") != word.endswith("1")),
        ]
        for dfa, predicate in operations:
            with self.subTest(operation=dfa.get("product_operation")):
                validate_dfa(dfa)
                for length in range(5):
                    for symbols in itertools.product("01", repeat=length):
                        word = "".join(symbols)
                        self.assertEqual(simulate(dfa, word)["accepted"], predicate(word))

    def test_complement_reachability_and_emptiness(self):
        complement = complement_dfa(self.ends_zero)
        self.assertEqual(reachable_states(self.ends_zero), set(self.ends_zero["states"]))
        self.assertFalse(is_language_empty(self.ends_zero))
        self.assertTrue(is_language_empty(intersection_dfa(self.ends_zero, self.ends_one)))
        self.assertTrue(simulate(complement, "1")["accepted"])
        self.assertFalse(simulate(complement, "0")["accepted"])
