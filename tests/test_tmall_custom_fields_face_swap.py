import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tests.test_tmall_ai_image_chain_script import load_script
from core import api_server, bala_ai_model_library


class CustomFieldsTests(unittest.TestCase):
    def test_ten_fields_roundtrip_and_explicit_matching_before_priority(self):
        m = load_script()
        workflow, _ = m.normalize_workflow_rows({'rows': [{'款号': '001', '品类': '外套', '自定义1': '合拍', '自定义10': '春节', '自定义11': '忽略'}]})
        workflow = m.workflow_from_dict(m.workflow_to_dict(workflow[0]))
        self.assertEqual(workflow.custom_fields, {'自定义1': '合拍', '自定义10': '春节'})
        prompts = m.prompt_items_from_cloud_templates([
            {'group_name': '上装', 'field_name': '默认', 'prompt': '普通单人图', 'priority': 1},
            {'group_name': '合拍', 'field_name': '多人创意', 'prompt': '多款合拍，场景 {{自定义10}}', 'priority': 99, 'custom_fields': workflow.custom_fields},
            {'group_name': '合拍', 'field_name': '另一场景', 'prompt': '多款合拍', 'priority': 1, 'custom_fields': {'自定义1': '合拍', '自定义10': '中秋'}},
        ])
        selected = m.select_prompts(workflow, prompts, 10)
        self.assertEqual([p.field_name for p in selected], ['多人创意'])
        text = m.build_prompt_text(selected[0], workflow)
        self.assertIn('场景 春节', text)
        self.assertNotIn('禁止把参考图', text)
        workflow.prompt_name = '默认'
        self.assertEqual(m.select_prompts(workflow, prompts), [])
        workflow.prompt_name = ''
        workflow.custom_fields = {}
        self.assertEqual(m.select_prompts(workflow, prompts)[0].field_name, '默认')

    def test_builtin_csv_prompt_template_can_be_read(self):
        m = load_script()
        prompts = m.read_prompt_library('adapters/tmall-ops-assistant/templates/tmall-ai-prompt-library-template.csv')
        self.assertEqual(len(prompts), 1)
        self.assertEqual(prompts[0].custom_fields, {})

    def test_excel_fields_import_and_output_rows(self):
        import openpyxl
        m = load_script()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'prompt.xlsx'
            w = openpyxl.Workbook(); s = w.active; s.title = '任意表名'
            s.append(['字段名', '描述内容', *m.CUSTOM_FIELD_NAMES])
            s.append(['创意拍', '场景 {{自定义10}}', '创意拍', *[''] * 8, '城市'])
            w.save(path); w.close()
            prompts = m.read_prompt_library(str(path))
        self.assertEqual(prompts[0].custom_fields, {'自定义1': '创意拍', '自定义10': '城市'})
        workflow = m.WorkflowItem(2, '001', '', '外套', '女', custom_fields=prompts[0].custom_fields)
        row = m.make_generation_row(workflow, prompts[0], ['a', 'b'], image_size='1024x1024', quality='auto', output_format='png', key_tier='2k')
        self.assertEqual(row['自定义10'], '城市')
        self.assertEqual(row['__1xm_reference_paths'], ['a', 'b'])


class FaceSwapTests(unittest.TestCase):
    def test_face_swap_uses_selected_result_model_and_keeps_source_and_newer_decisions(self):
        m = load_script()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'generated.png'; model = root / 'model.png'; output = root / 'face.png'
            for path in [source, model, output]: path.write_bytes(b'image')
            asset = {'id': 'source', 'kind': 'ai', 'path': str(source), 'label': 'AI 1', 'status': 'approved', 'generation_row': {'模型': 'semir/gpt-image-2', '尺寸': '1024x1024', '生成数量': 4}}
            batch = {'batch_id': 'batch', 'artifact_dir': tmp, 'json_path': str(root/'batch.json'), 'items': [{'id': 'item', 'style_code': '001', 'assets': [asset]}]}
            latest = copy.deepcopy(batch); latest['items'][0]['assets'][0]['status'] = 'rejected'
            Path(batch['json_path']).write_text(json.dumps(latest))
            original = copy.deepcopy(asset)
            with patch.object(bala_ai_model_library, 'load_model_library', return_value={'items': [{'id': 'm1', 'name': '测试模特'}]}), \
                 patch.object(bala_ai_model_library, 'resolve_model_image_path', return_value=model), \
                 patch.object(m, 'resolve_one_xm_settings', return_value={}), \
                 patch.object(m, 'require_one_xm_key_for_generation'), \
                 patch.object(m, 'run_one_xm_generation_row', side_effect=lambda row, *_: row) as execute, \
                 patch.object(m, 'download_generated_images', return_value=[str(output)]), \
                 patch.object(m, 'save_approval_batch') as save:
                result = m.face_swap_approval_asset(batch, 'source', 'm1', '表情自然')
            payload = execute.call_args.args[0]
            self.assertEqual(payload['__1xm_reference_paths'], [str(source), str(model)])
            self.assertEqual(payload['__1xm_payload']['model'], 'semir/gpt-image-2')
            self.assertEqual(payload['__1xm_payload']['n'], 1)
            self.assertIn('补充要求', payload['最终提示词'])
            self.assertEqual(asset, original)
            self.assertEqual(result['status'], 'pending')
            self.assertEqual(result['source_asset_id'], 'source')
            saved = save.call_args.args[0]
            self.assertEqual(saved['items'][0]['assets'][0]['status'], 'rejected')
            self.assertEqual(len(saved['items'][0]['assets']), 2)

    def test_invalid_source_and_model_do_not_generate(self):
        m = load_script()
        with patch.object(m, 'generate_approval_asset_for_item') as generate:
            with self.assertRaises(ValueError):
                m.face_swap_approval_asset({'items': [{'assets': [{'id': 'a', 'kind': 'origin', 'path': 'x'}]}]}, 'a', 'model')
            generate.assert_not_called()

    def test_api_rejects_wrong_batch_token_before_execution(self):
        import asyncio
        request = api_server.TmallApprovalFaceSwapRequest(asset_id='a', model_id='m')
        with patch.object(api_server, '_load_tmall_approval_batch', return_value={'token': 'valid'}), \
             patch.object(api_server, '_load_tmall_ai_image_chain_module') as loader:
            with self.assertRaises(api_server.HTTPException):
                asyncio.run(api_server.face_swap_tmall_ai_image_approval_asset('batch', request, 'invalid'))
            loader.assert_not_called()
