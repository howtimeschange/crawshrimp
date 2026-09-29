import unittest
from unittest.mock import Mock
from core.shoe_specialist.identity import verify
from core.shoe_specialist.worker import resolve_label

STYLE = '204426140134'

def lines(color_text=None):
    result = [
        {'text': STYLE, 'box': [.2,.8,.4,.05]},
        {'text': '产品名称：儿童户外鞋', 'box': [.1,.5,.3,.04]},
    ]
    if color_text:
        result.append({'text': color_text, 'box': [.1,.44,.3,.04]})
    return result

def check(items, color='00323'):
    return verify([l['text'] for l in items], STYLE, color, [l['box'] for l in items])

def group():
    return {'style': STYLE, 'color': '00323', 'slots': {'wpz6': {'path':'first.jpg'}},
            'label_candidates': [{'path':'first.jpg'}, {'path':'second.jpg'}]}

class RecoveryTests(unittest.TestCase):
    def test_multi_color_names_with_separators_keep_exact_color_code(self):
        from core.shoe_specialist.worker import label_data
        for text, color in [('颜色：米白/浅灰粉/蓝色80001', '80001'), ('颜色：米白/灰色/藕粉60001', '60001')]:
            result = label_data(lines(text), STYLE, color)
            self.assertEqual(result['color_name'], text.removeprefix('颜色：'))
            self.assertEqual(result['check']['color_tokens'], [color])
            self.assertEqual(check(lines(text))['status'], 'mismatch')

    def test_damaged_headers_need_color_word_and_label_location(self):
        for text in ['额色：灰黄色调00323', '色：灰黄00323']:
            self.assertTrue(check(lines(text))['passed'])
        for text in ['00323', '批次00323', '额色：批次00323', '编号：00323']:
            self.assertEqual(check(lines(text))['status'], 'unconfirmed')
        remote = lines('额色：灰黄色调00323')
        remote[-1]['box'] = [.7,.1,.2,.04]
        self.assertFalse(check(remote)['passed'])
        self.assertFalse(check([lines('额色：灰黄色调00323')[-1]])['passed'])
        table = lines('颜色') + [{'text':'00323','box':[.7,.1,.2,.04]}]
        self.assertFalse(check(table)['passed'])
        table[-1]['box'] = [.1,.38,.2,.04]
        self.assertTrue(check(table)['passed'])

    def test_conflicting_codes_cannot_pass_by_containing_expected_code(self):
        self.assertEqual(check(lines('颜色：浅灰20001'))['status'], 'mismatch')
        both = lines('颜色：灰黄00323') + [{'text':'颜色：浅灰20001','box':[.1,.4,.3,.04]}]
        self.assertEqual(check(both)['status'], 'mismatch')
        self.assertEqual(check(lines('颜色：灰黄00323') + [{'text':'204426140135','box':[.1,.2,.3,.04]}])['status'], 'mismatch')

    def test_crop_retry_then_candidate_replacement(self):
        g = group()
        reader = Mock(side_effect=[{'lines': []}, {'lines':lines('颜色：灰黄00323')}])
        def recognize(jobs): return [reader(jobs)]
        resolve_label(g, lines(), recognize)
        self.assertEqual(g['label_status'], 'verified')
        self.assertEqual(g['slots']['wpz6']['path'], 'second.jpg')
        self.assertIn('region', reader.call_args_list[0].args[0][0])
        self.assertNotIn('region', reader.call_args_list[1].args[0][0])

    def test_missing_color_is_pending_and_other_group_still_runs(self):
        pending = group()
        reader = Mock(return_value=[{'lines':[]}])
        resolve_label(pending, [], reader)
        self.assertEqual(pending['label_status'], 'unconfirmed')
        valid = group()
        resolve_label(valid, lines('颜色：灰黄00323'), reader)
        self.assertEqual(valid['label_status'], 'verified')

    def test_conflict_is_not_hidden_by_retry(self):
        g = group()
        g['label_candidates'] = g['label_candidates'][:1]
        reader = Mock(side_effect=AssertionError('must not erase conflicting identity'))
        resolve_label(g, lines('颜色：浅灰20001'), reader)
        self.assertEqual(g['label_status'], 'mismatch')
        reader.assert_not_called()

    def test_conflicting_source_is_rejected_but_verified_other_source_can_recover(self):
        g = group()
        reader = Mock(return_value=[{'lines': lines('颜色：灰黄00323')}])
        resolve_label(g, lines('颜色：浅灰20001'), reader)
        self.assertEqual(g['label_status'], 'verified')
        self.assertEqual(g['slots']['wpz6']['path'], 'second.jpg')
        self.assertEqual(g['rejected_label_sources'][0]['path'], 'first.jpg')
        self.assertEqual(reader.call_args.args[0], [{'id': STYLE+'-00323', 'path':'second.jpg'}])

    def test_printed_sku_line_requires_label_context_and_independent_style_crop(self):
        merged = [{'text':t, 'box':[.1,.2,.6,.05], 'confidence':.99}
                  for t in ['EUR','CHN','RMB 329.00',STYLE+' 00323 21-30']]
        self.assertTrue(check(merged)['passed'])
        self.assertEqual(check(merged, '00416')['status'], 'mismatch')
        self.assertFalse(check(merged[-1:])['passed'])
        g = group()
        reader = Mock(return_value=[{'lines':[{'text':STYLE,'box':[.1,.2,.3,.05],'confidence':.99}]}])
        resolve_label(g, merged, reader)
        self.assertEqual(g['label_status'], 'verified')
        self.assertAlmostEqual(g['label']['style_code_bbox'][2], .4)
        self.assertIn('style_region_ocr',g['label_attempts'][0])
        g = group()
        g['label_candidates'] = g['label_candidates'][:1]
        resolve_label(g, merged, Mock(return_value=[{'lines': []}]))
        self.assertNotEqual(g['label_status'], 'verified')

    def test_two_color_headers_do_not_prefix_the_same_value_twice(self):
        import tempfile
        from pathlib import Path
        from PIL import Image
        from unittest.mock import patch
        from core.shoe_specialist.ocr import recognize
        def item(x,y,w,text):
            return [[[x,y],[x+w,y],[x+w,y+20],[x,y+20]],text,.99]
        raw=[item(100,100,70,'颜色'),item(190,100,70,'色号'),
             item(100,140,170,'白红色调00416'),item(100,60,180,STYLE)]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'label.png';Image.new('RGB',(500,400),'white').save(path)
            with patch('rapidocr_onnxruntime.RapidOCR',return_value=Mock(return_value=(raw,None))):
                record=recognize([{'id':'test','path':str(path)}])[0]
        text=[l['text'] for l in record['lines']]
        self.assertEqual(text[2],'颜色：白红色调00416')
        self.assertTrue(verify(text,STYLE,'00416')['passed'])

    def test_preflight_requires_every_style_but_keeps_other_strategies(self):
        from core.api_server import _validate_shenhui_shoe_categories
        for rows in [[{'款号':STYLE,'品类':''}], [{'款号':STYLE,'品类':'运动'},{'款号':'204426140135','品类':''}]]:
            with self.assertRaisesRegex(ValueError, '补全后再开始'):
                _validate_shenhui_shoe_categories({'shoe_category_file':{'rows':rows}})
        _validate_shenhui_shoe_categories({'shoe_category_file':{'rows':[{'款号':STYLE,'品类':'运动'}]}})
        _validate_shenhui_shoe_categories({'shoe_pose_strategy':'single_sheet','shoe_category_file':{'rows':[{'款号':STYLE,'品类':''}]}})

    def test_crop_ocr_coordinates_remain_relative_to_original_image(self):
        import tempfile
        from pathlib import Path
        from PIL import Image
        from unittest.mock import patch
        from core.shoe_specialist.ocr import recognize
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.png'
            Image.new('RGB', (1000, 800), 'white').save(path)
            result = [[[[10,20],[110,20],[110,60],[10,60]], STYLE, .99]]
            with patch('rapidocr_onnxruntime.RapidOCR', return_value=Mock(return_value=(result, None))):
                output = recognize([{'id':STYLE,'path':str(path),'region':[.2,.25,.8,.75]}])
            box = output[0]['lines'][0]['box']
            for actual, expected in zip(box, [.21,.675,.1,.05]):
                self.assertAlmostEqual(actual, expected)

    def test_crop_retains_independently_decoded_barcode_despite_ocr_quotes(self):
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from PIL import Image
        from unittest.mock import patch
        import zxingcpp
        from core.shoe_specialist.ocr import recognize
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.png'
            Image.new('RGB', (1000,800), 'white').save(path)
            for raw_text in ['6"914678701777', '6 l914678701777]']:
                result = [[[[10,20],[110,20],[110,60],[10,60]], raw_text, .99]]
                barcode = SimpleNamespace(text='6914678701777', format=zxingcpp.BarcodeFormat.EAN13)
                with patch('rapidocr_onnxruntime.RapidOCR', return_value=Mock(return_value=(result,None))), patch('zxingcpp.read_barcodes',side_effect=[[barcode],[]]):
                    output = recognize([{'id':STYLE,'path':str(path),'region':[.2,.25,.8,.75]}])
                self.assertEqual(output[0]['lines'][0]['text'],'6914678701777')
                self.assertTrue(output[0]['lines'][0]['barcode_verified'])
                with patch('rapidocr_onnxruntime.RapidOCR', return_value=Mock(return_value=(result,None))), patch('zxingcpp.read_barcodes',return_value=[]):
                    unverified = recognize([{'id':STYLE,'path':str(path)}])
                self.assertEqual(unverified[0]['lines'][0]['text'],raw_text)

    def test_pending_color_is_cached_and_originals_are_retained(self):
        import tempfile,json
        from pathlib import Path
        from unittest.mock import patch
        from core import shenhui_shoe_specialist as specialist
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'bundle.json').write_text('{}')
            from PIL import Image
            source = root/'source.jpg'
            Image.new('RGB', (100, 100), 'white').save(source)
            rows = [{'输入款号':STYLE,'颜色':'00323','下载结果':'已下载','本地文件':str(source),'原文件名':'source.jpg'}]
            def launch(command, **kwargs):
                out = Path(command[command.index('--out')+1])
                (out/'selection.json').write_text(json.dumps([{'style':STYLE,'color':'00323','label_status':'unconfirmed','label_error':'款色无法确认，待复核'}]))
                return Mock(poll=Mock(return_value=0), returncode=0)
            def export(**kwargs):
                cached = kwargs['_prepared_colors'][STYLE,'00323']
                self.assertTrue(cached['error'])
                return cached['report_rows'], {}
            with patch('subprocess.Popen',side_effect=launch), patch.object(specialist, 'sha',return_value='digest'), patch('core.shenhui_shoe_packaging.prepare_shoe_packages',side_effect=export):
                reports, roots = specialist.prepare(data_rows=rows,output_root=root/'out',specialist_bundle=root,shoe_categories={STYLE:'运动'})
            self.assertFalse(roots)
            self.assertEqual(reports[0]['处理动作'],'待复核已跳过')
            self.assertEqual((Path(reports[0]['本地文件'])/'source.jpg').read_bytes(),source.read_bytes())

    def test_finalize_keeps_pending_style_alongside_completed_style(self):
        import tempfile
        from pathlib import Path
        from core import api_server
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            runtime = base/'runtime'
            completed = runtime/'shoe-packages'/STYLE
            pending = runtime/'shoe-packages'/'204426140135'
            completed.mkdir(parents=True)
            raw = pending/'_待核验原图'/'00323'
            raw.mkdir(parents=True)
            (completed/'completed.txt').write_text('completed')
            (raw/'original.txt').write_text('preserved')
            params = {'export_folder':str(base/'export'), '__shenhui_shoe_package_refs':[str(completed)], '__shenhui_shoe_pending_refs':[str(pending)]}
            refs = api_server._finalize_shenhui_new_arrival_outputs(task_id='prepare_shoe_upload_package',data_rows=[],runtime_files=[],exported_files=[],run_params=params,runtime_artifact_dir=str(runtime),log=lambda _:None)
            self.assertTrue((base/'export'/STYLE/'completed.txt').is_file())
            self.assertEqual((base/'export'/'204426140135'/'_待核验原图'/'00323'/'original.txt').read_text(),'preserved')
            self.assertEqual(len(refs),2)
            with self.assertRaisesRegex(ValueError,'0 个图包'):
                api_server._require_shenhui_shoe_package_result([],{'__shenhui_shoe_pending_refs':[str(pending)]})
