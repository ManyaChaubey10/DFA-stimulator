"""HTTP-level integration checks against a real local Uvicorn process."""
import json
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            cls.port = listener.getsockname()[1]
        cls.base_url = f'http://127.0.0.1:{cls.port}'
        backend_dir = Path(__file__).resolve().parents[1]
        cls.server = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(cls.port)],
            cwd=backend_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                raise RuntimeError('Uvicorn exited before the API became available.')
            try:
                with urlopen(cls.base_url + '/health', timeout=1) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(0.1)
        cls.server.terminate()
        raise RuntimeError('Timed out waiting for the integration API.')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)

    def post_json(self, path, payload):
        request = Request(
            self.base_url + path,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode('utf-8'))
        except HTTPError as error:
            return error.code, json.loads(error.read().decode('utf-8'))

    def test_plain_english_generation_over_http(self):
        status, dfa = self.post_json('/api/dfa/natural', {
            'alphabet': ['0', '1'],
            'description': 'Binary strings ending with 01',
        })
        self.assertEqual(status, 200)
        self.assertEqual(dfa['alphabet'], ['0', '1'])
        self.assertEqual(dfa['start_state'], 'q0')
        self.assertEqual(dfa['description'], 'Binary strings ending with 01')
        self.assertTrue(dfa['complete'])
        self.assertEqual(dfa['interpreted_ast'], {'op': 'ends_with', 'pattern': '01'})
        self.assertIn('ends with 01', dfa['interpretation_explanation'])
        self.assertTrue(dfa['states'])
        self.assertTrue(all(set(row) == set(dfa['alphabet']) for row in dfa['transitions'].values()))
        self.assertIn('minimized_dfa', dfa)

        status, result = self.post_json('/api/simulate', {'dfa': dfa, 'input': '1101'})
        self.assertEqual(status, 200)
        self.assertTrue(result['accepted'])

    def test_health_reports_all_required_routes(self):
        with urlopen(self.base_url + '/health', timeout=5) as response:
            health = json.loads(response.read().decode('utf-8'))
            self.assertEqual(response.status, 200)
        self.assertEqual(health['status'], 'ok')
        self.assertIn('POST /api/interpret', health['required_routes'])
        self.assertEqual(health['missing_routes'], [])

    def test_positional_plain_english_dfa_and_simulator_over_http(self):
        payload = {'alphabet': ['a', 'b'], 'description': 'Second symbol from the right is a'}
        status, interpreted = self.post_json('/api/interpret', payload)
        self.assertEqual(status, 200)
        self.assertEqual(interpreted['ast'], {
            'op': 'position_from_right', 'position': 2, 'symbol': 'a',
        })
        status, dfa = self.post_json('/api/dfa/natural', payload)
        self.assertEqual(status, 200)
        self.assertEqual(len(dfa['minimized_dfa']['states']), 4)
        self.assertEqual(set(dfa['alphabet']), {'a', 'b'})
        self.assertTrue(all(set(row) == {'a', 'b'} for row in dfa['transitions'].values()))
        for value in ('aa', 'ab', 'aaa', 'aab', 'bab'):
            with self.subTest(accepted=value):
                sim_status, result = self.post_json('/api/simulate', {'dfa': dfa['minimized_dfa'], 'input': value})
                self.assertEqual(sim_status, 200)
                self.assertTrue(result['accepted'])
        for value in ('ba', 'bb', 'abb', 'a', ''):
            with self.subTest(rejected=value):
                sim_status, result = self.post_json('/api/simulate', {'dfa': dfa['minimized_dfa'], 'input': value})
                self.assertEqual(sim_status, 200)
                self.assertFalse(result['accepted'])

    def test_interpretation_endpoint_returns_reviewable_ast(self):
        status, interpreted = self.post_json('/api/interpret', {
            'alphabet': ['0', '1'],
            'description': 'Second symbol from the right is 1',
        })
        self.assertEqual(status, 200)
        self.assertEqual(interpreted['ast'], {'op': 'position_from_right', 'position': 2, 'symbol': '1'})
        self.assertEqual(interpreted['source'], 'deterministic')

    def test_interpretation_identifies_known_non_regular_language(self):
        status, result = self.post_json('/api/interpret', {
            'alphabet': ['a', 'b'], 'description': '{a^n b^n | n >= 0}',
        })
        self.assertEqual(status, 422)
        self.assertIn('known non-regular', result['detail'])

    def test_natural_endpoint_compiles_user_corrected_ast(self):
        status, dfa = self.post_json('/api/dfa/natural', {
            'alphabet': ['0', '1'], 'description': 'manual correction',
            'ast': {'op': 'length_mod', 'modulus': 3, 'remainder': 1},
        })
        self.assertEqual(status, 200)
        self.assertEqual(dfa['interpretation_source'], 'user-edited')
        self.assertEqual(dfa['interpreted_ast']['op'], 'length_mod')


    def test_check_endpoint_accepts_equivalent_student_dfa(self):
        reference = self.post_json('/api/dfa', {'alphabet': ['0', '1'], 'expression': '(0|1)*01'})[1]
        status, result = self.post_json('/api/check', {
            'mode': 'regex', 'alphabet': ['0', '1'], 'expression': '(0|1)*01', 'dfa': reference['minimized_dfa'],
        })
        self.assertEqual(status, 200)
        self.assertTrue(result['equivalent'])

    def test_check_accepts_equivalent_nonminimal_student_dfa(self):
        # Two accepting states encode the same residual language; minimality is not required.
        nonminimal = {
            'states': ['start', 'pending', 'accept', 'accept-copy'],
            'alphabet': ['0', '1'],
            'transitions': {
                'start': {'0': 'pending', '1': 'start'},
                'pending': {'0': 'pending', '1': 'accept'},
                'accept': {'0': 'pending', '1': 'start'},
                'accept-copy': {'0': 'pending', '1': 'start'},
            },
            'start_state': 'start', 'accepting_states': ['accept', 'accept-copy'],
        }
        status, result = self.post_json('/api/check', {
            'mode': 'regex', 'alphabet': ['0', '1'], 'expression': '(0|1)*01', 'dfa': nonminimal,
        })
        self.assertEqual(status, 200)
        self.assertTrue(result['available'])
        self.assertTrue(result['equivalent'])

    def test_check_marks_uninterpretable_reference_as_unavailable(self):
        valid_student = {
            'states': ['only'], 'alphabet': ['0', '1'],
            'transitions': {'only': {'0': 'only', '1': 'only'}},
            'start_state': 'only', 'accepting_states': [],
        }
        status, result = self.post_json('/api/check', {
            'mode': 'natural', 'alphabet': ['0', '1'],
            'description': 'a language that cannot be interpreted reliably', 'dfa': valid_student,
        })
        self.assertEqual(status, 200)
        self.assertFalse(result['available'])
        self.assertIn('Verification unavailable', result['message'])

    def test_check_endpoint_returns_shortest_counterexample(self):
        rejecting = {'states': ['r'], 'alphabet': ['0', '1'], 'transitions': {'r': {'0': 'r', '1': 'r'}}, 'start_state': 'r', 'accepting_states': []}
        status, result = self.post_json('/api/check', {
            'mode': 'natural', 'alphabet': ['0', '1'], 'description': 'Binary strings ending with 01', 'dfa': rejecting,
        })
        self.assertEqual(status, 200)
        self.assertFalse(result['equivalent'])
        self.assertEqual(result['counterexample'], '01')
        self.assertFalse(result['student_result']['accepted'])
        self.assertTrue(result['expected_result']['accepted'])

    def test_check_endpoint_rejects_incomplete_student_dfa(self):
        incomplete = {'states': ['q'], 'alphabet': ['0', '1'], 'transitions': {'q': {'0': 'q'}}, 'start_state': 'q', 'accepting_states': []}
        status, result = self.post_json('/api/check', {
            'mode': 'regex', 'alphabet': ['0', '1'], 'expression': '0*', 'dfa': incomplete,
        })
        self.assertEqual(status, 422)
        self.assertIn('Missing transition', result['detail'])

    def test_regular_expression_route_still_works_over_http(self):
        status, dfa = self.post_json('/api/dfa', {
            'alphabet': ['0', '1'],
            'expression': '(0|1)*01',
        })
        self.assertEqual(status, 200)
        self.assertTrue(dfa['complete'])
        self.assertEqual(dfa['alphabet'], ['0', '1'])
        self.assertIn('minimized_dfa', dfa)


if __name__ == '__main__':
    unittest.main()
