import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class DeployTests(unittest.TestCase):
    def commands(self, *args):
        if args[0] == 'gh':
            return '{"source":{"branch":"main","path":"/"},"build_type":"legacy"}'
        return ''

    def test_missing_token_stops_before_network(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(deploy, 'command') as cmd:
            with self.assertRaisesRegex(RuntimeError, 'Falta'):
                deploy.deploy(True)
            cmd.assert_not_called()

    def test_failed_migration_never_pushes(self):
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN':'test-only'}), \
             patch.object(deploy, 'command', side_effect=self.commands) as cmd, \
             patch.object(deploy, 'query', side_effect=[[{'ready':True}], RuntimeError('migration failed')]):
            with self.assertRaisesRegex(RuntimeError, 'migration failed'):
                deploy.deploy(True)
            self.assertFalse(any(call.args[:2] == ('git','push') for call in cmd.call_args_list))

    def test_preflight_does_not_mutate_database(self):
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN':'test-only'}), \
             patch.object(deploy, 'command', side_effect=self.commands) as cmd, \
             patch.object(deploy, 'query', return_value=[{'ready':True}]) as query:
            deploy.deploy(False)
            query.assert_called_once()
            self.assertTrue(query.call_args.args[0].startswith('SELECT'))
            self.assertFalse(any(call.args[:2] == ('git','push') for call in cmd.call_args_list))

if __name__ == '__main__':
    unittest.main()
