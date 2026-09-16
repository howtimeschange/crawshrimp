import unittest
from unittest.mock import patch
from core import llm_gateway as gateway
from core import api_server as api

class LlmProviderSettingsTests(unittest.TestCase):
    def config(self):
        return {'ai': {'llm': {'api_key': 'legacy-test', 'overseas_openai_api_key': 'openai-test', 'custom_providers': [
            {'id':'custom-a','name':'A','protocol':'openai','base_url':'https://example.com/v1','api_key':'a-test','models':[{'id':'same'}]},
            {'id':'custom-b','name':'B','protocol':'anthropic','base_url':'https://example.org','api_key':'b-test','models':[{'id':'same'}]},
        ]}}}

    def test_route_uses_independent_key_and_legacy_fallback(self):
        with patch.dict('os.environ', {}, clear=True):
            config = self.config()
            self.assertEqual(gateway.route_for_model('gpt-6-astra', config).api_key, 'openai-test')
            self.assertEqual(gateway.route_for_model('claude-sonnet-5', config).api_key, 'legacy-test')
            del config['ai']['llm']['api_key']
            self.assertFalse(gateway.model_has_configured_key('claude-sonnet-5', config))
            self.assertTrue(gateway.model_has_configured_key('gpt-6-astra', config))

    def test_custom_model_selection_is_provider_qualified(self):
        config = self.config()
        a = gateway.route_for_model('custom-a/same', config)
        b = gateway.route_for_model('custom-b/same', config)
        self.assertEqual((a.model_id, a.protocol, a.api_key), ('same','openai','a-test'))
        self.assertEqual((b.model_id, b.protocol, b.api_key), ('same','anthropic','b-test'))
        config['ai']['llm']['default_model'] = 'custom-b/same'
        self.assertEqual(gateway.select_default_model(config), 'custom-b/same')

    def test_readback_redacts_keys_and_preserves_custom_secret_on_edit(self):
        config = self.config()
        with patch.object(api, 'load_config', return_value=config):
            public = api._public_settings()['ai']['llm']
            self.assertNotIn('api_key', public)
            self.assertNotIn('overseas_openai_api_key', public)
            self.assertTrue(public['overseas_anthropic_configured'])
            self.assertTrue(public['custom_providers'][0]['configured'])
            self.assertNotIn('api_key', public['custom_providers'][0])
            custom = public['custom_providers']
            custom[0]['name'] = 'Renamed'
            patch_data = api._safe_settings_write_patch({'ai.llm.custom_providers': custom, 'ai.llm.overseas_openai_api_key': api._LLM_MASKED_CREDENTIAL})
            self.assertEqual(patch_data['ai.llm.custom_providers'][0]['api_key'], 'a-test')
            self.assertNotIn('ai.llm.overseas_openai_api_key', patch_data)
            self.assertNotIn('configured', patch_data['ai.llm.custom_providers'][0])
            self.assertEqual(api._safe_settings_write_patch({'ai.llm.custom_providers': []})['ai.llm.custom_providers'], [])

if __name__ == '__main__': unittest.main()
