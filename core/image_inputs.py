"""Ordered image inputs shared by desktop, scripts and generation snapshots."""
from copy import deepcopy

MAX_MAIN_IMAGES = 6
MAX_INPUT_IMAGES = 10
INPUT_FIELDS = ('id', 'path', 'role', 'name', 'size', 'mime', 'sha256', 'source', 'imported_at')
PARAM_FIELDS = ('size', 'ratio', 'quality', 'response_format', 'output_format', 'n', 'model_key_tier', 'background', 'output_compression', 'mask', 'main_image_path', 'main_image_paths', 'reference_image_paths', 'input_assets')


def normalize_inputs(params, legacy_assets=()):
    if 'input_assets' in params:
        raw = params['input_assets']
        if not isinstance(raw, list):
            raise ValueError('输入素材列表格式无效')
    elif any(key in params for key in ('main_image_path', 'main_image_paths', 'reference_image_paths')):
        mains = params.get('main_image_paths')
        if mains is None:
            mains = [params.get('main_image_path')] if params.get('main_image_path') else []
        refs = params.get('reference_image_paths') or []
        if isinstance(refs, str): refs = [refs]
        if not isinstance(mains, list) or not isinstance(refs, list):
            raise ValueError('主图和参考图必须是有序列表')
        raw = [{'path': p, 'role': role} for role, paths in [('main', mains), ('reference', refs)] for p in paths if p]
    else:
        raw = sorted(legacy_assets or [], key=lambda item: (int(item.get('sort_order') or 0), int(item.get('id') or 0)))
        raw = [dict(item, role=item.get('kind')) for item in raw if item.get('kind') in ('main', 'reference')]
    result = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or item.get('role') not in ('main', 'reference') or not str(item.get('path') or '').strip():
            raise ValueError(f'第 {index + 1} 张素材缺少文件或角色')
        asset = {key: deepcopy(item[key]) for key in INPUT_FIELDS if key in item}
        asset.update(path=str(item['path']).strip(), role=item['role'])
        result.append(asset)
    # Preserve order within each role; the explicit wire order is main then reference.
    result = [a for a in result if a['role'] == 'main'] + [a for a in result if a['role'] == 'reference']
    if len(result) > MAX_INPUT_IMAGES:
        raise ValueError(f'主图和参考图共 {len(result)} 张，最多支持 10 张，请减少后重试')
    if sum(a['role'] == 'main' for a in result) > MAX_MAIN_IMAGES:
        raise ValueError('主体素材最多支持 6 张，请减少后重试')
    return result


def snapshot_params(params):
    result = {key: deepcopy(params[key]) for key in PARAM_FIELDS if key in params}
    if isinstance(result.get('input_assets'), list):
        result['input_assets'] = [{key: value for key, value in item.items() if key in INPUT_FIELDS} for item in result['input_assets'] if isinstance(item, dict)]
    return result


def compile_input_prompt(prompt, params, inputs):
    # Old callers retain their prompt verbatim. New structured inputs expose their mapping.
    if 'input_assets' not in params or not inputs:
        return prompt
    lines = ['【输入图片顺序】']
    for i, asset in enumerate(inputs, 1):
        role = '主图' if asset['role'] == 'main' else '参考图'
        lines.append(f"图 {i}：{role}。")
    return str(prompt).strip() + '\n\n' + '\n'.join(lines)
