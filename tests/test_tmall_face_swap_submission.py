import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch
from core import tmall_face_swap_submission as guard
from core.one_xm_image import RejectedOneXMImageError


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.batch = {'batch_id': 'b', 'json_path': str(Path(self.tmp.name) / 'batch.json')}

    def test_disconnect_survives_reload_and_changed_request_or_model(self):
        generate = Mock(side_effect=ConnectionError('remote closed'))
        with self.assertRaises(guard.SubmissionBlocked):
            guard.execute(self.batch, 'a', 'r1', generate)
        with self.assertRaises(guard.SubmissionBlocked):
            guard.execute(dict(self.batch), 'a', 'r2', generate)
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(guard.blocked_assets(self.batch), {'a'})

    def test_inflight_blocks_concurrent_submission(self):
        duplicate = Mock()
        def generate():
            with self.assertRaises(guard.SubmissionBlocked):
                guard.execute(self.batch, 'a', 'other', duplicate)
            return {'id': 'result'}
        guard.execute(self.batch, 'a', 'r', generate)
        duplicate.assert_not_called()

    def test_lost_success_reply_returns_same_asset_without_generation(self):
        generate = Mock(return_value={'id': 'result'})
        first = guard.execute(self.batch, 'a', 'r', generate)
        self.assertEqual(guard.execute(self.batch, 'a', 'r', generate), first)
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(guard.blocked_assets(self.batch), set())

    def test_explicit_rejection_allows_manual_retry(self):
        generate = Mock(side_effect=[RejectedOneXMImageError('401'), {'id': 'result'}])
        with self.assertRaises(RejectedOneXMImageError):
            guard.execute(self.batch, 'a', 'r', generate)
        self.assertEqual(guard.execute(self.batch, 'a', 'r', generate)['id'], 'result')

    def test_crash_left_submitting_record_does_not_expire(self):
        with self.assertRaises(KeyboardInterrupt):
            guard.execute(self.batch, 'a', 'r', Mock(side_effect=KeyboardInterrupt))
        with self.assertRaises(guard.SubmissionBlocked):
            guard.execute(self.batch, 'a', 'new', Mock())

    def test_decode_error_after_submission_is_also_unknown(self):
        with self.assertRaises(guard.SubmissionBlocked):
            guard.execute(self.batch, 'a', 'r', Mock(side_effect=ValueError('invalid response')))
        self.assertEqual(guard.blocked_assets(self.batch), {'a'})

    def test_api_reports_unknown_and_readback_blocks_reopened_dialog(self):
        import asyncio
        from core import api_server as api
        batch = {**self.batch, 'token': 'test', 'items': [{'assets': [{'id': 'a', 'path': 'original.png'}]}]}
        module = Mock()
        module.face_swap_approval_asset.side_effect = ConnectionError('remote closed')
        with patch.object(api, '_load_tmall_approval_batch', return_value=batch), patch.object(api, '_load_tmall_ai_image_chain_module', return_value=module):
            for request_id in ('first', 'new-after-reopen'):
                result = asyncio.run(api.face_swap_tmall_ai_image_approval_asset('b', api.TmallApprovalFaceSwapRequest(asset_id='a', model_id='m', request_id=request_id), 'test'))
                self.assertEqual(result['error_code'], 'UNKNOWN_SUBMIT_RESULT')
                self.assertFalse(result['retry_allowed'])
            reopened = api.get_tmall_ai_image_approval_batch('b', 'test')
            self.assertTrue(reopened['items'][0]['assets'][0]['face_swap_blocked'])
            self.assertEqual(reopened['items'][0]['assets'][0]['path'], 'original.png')
        self.assertEqual(module.face_swap_approval_asset.call_count, 1)
