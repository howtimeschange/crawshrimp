from pathlib import Path
import yaml
from core.adapter_loader import _read_manifest_file, resolve_adapter_relative_file

ROOT = Path(__file__).resolve().parents[1]

def test_mini_bala_adapter_loads_and_preserves_form_and_excel_contract():
    directory = ROOT / 'adapters/mini-bala-launch-assistant'
    adapter = _read_manifest_file(directory / 'manifest.yaml')
    assert adapter.id == 'mini-bala-launch-assistant'
    assert adapter.name == '迷你巴拉上新助手'
    assert resolve_adapter_relative_file(directory, adapter.tasks[0].script).is_file()
    mini = yaml.safe_load((directory / 'manifest.yaml').read_text())['tasks'][0]
    original = yaml.safe_load((ROOT / 'adapters/plm-ops-assistant/manifest.yaml').read_text())['tasks'][0]
    assert [(p['id'], p['type']) for p in mini['params']] == [(p['id'], p['type']) for p in original['params']]
    assert mini['output'][0]['sheets'] == original['output'][0]['sheets']
    assert mini['output'][0]['columns'] == original['output'][0]['columns']
    assert mini['output'][0]['sheet_key'] == '__sheet_name'
    assert mini['entry_url'].startswith('https://plm.balabala.com/')

def test_image_package_task_uses_cloud_entry_and_existing_ai_backend():
    directory = ROOT / 'adapters/mini-bala-launch-assistant'
    adapter = _read_manifest_file(directory / 'manifest.yaml')
    task = next(t for t in adapter.tasks if t.id == 'prepare_image_package')
    assert task.entry_url.startswith('https://fmp.semirapp.com/')
    assert resolve_adapter_relative_file(directory, task.script).is_file()
    assert not task.skip_auth
    raw = yaml.safe_load((directory / 'manifest.yaml').read_text())
    params = {p['id']:p for p in next(t for t in raw['tasks'] if t['id']=='prepare_image_package')['params']}
    assert params['copy_file']['type']=='file_excel'
    assert '每色' in params['main_colors']['hint']
    assert raw['backend_handlers'][0]['entrypoint']=='core.mini_bala_packaging:package_images'
