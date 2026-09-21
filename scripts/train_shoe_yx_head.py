"""Fit only the shared YX head from reviewed, hash-bound offline features.

Leave-one-style-out results are development regression, not independent acceptance.
This tool writes a candidate head; it never installs or releases model resources.
"""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from threadpoolctl import threadpool_limits

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest', type=Path, required=True)
    ap.add_argument('--features', type=Path, required=True)
    ap.add_argument('--provenance', type=Path, required=True)
    ap.add_argument('--baseline', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    data = json.loads(args.manifest.read_text())
    rows, templates = data['rows'], data['templates']
    provenance = json.loads(args.provenance.read_text())
    assert provenance['feature_sha256'] == digest(args.features)
    assert provenance['inputs'] == [[r['id'], r['sha256']] for r in rows + templates]
    for row in rows + templates:
        assert digest(row['path']) == row['sha256'], 'Changed source image'
    assert all(r['yx_label'] in (0, 1) and r['yx_review'] for r in rows)
    x = np.load(args.features)['spatial']
    y = np.array([r['yx_label'] for r in rows] + [int(t['label'] == 'yx') for t in templates])
    seen, template_ids = set(), []
    for i, t in enumerate(templates, len(rows)):
        if t['sha256'] not in seen:
            seen.add(t['sha256'])
            template_ids.append(i)
    groups = sorted({(r['style'], r['color']) for r in rows})

    def evaluate(probabilities, heldout=None):
        cases = []
        for style, color in groups:
            if heldout is not None and style != heldout:
                continue
            ids = [i for i, r in enumerate(rows) if (r['style'], r['color']) == (style, color)]
            ranking = sorted(ids, key=lambda i: -probabilities[i])
            best = ranking[0]
            accepted = probabilities[best] >= .5
            gold = [rows[i]['id'] for i in ids if y[i]]
            cases.append({'style': style, 'color': color, 'gold_ids': gold,
                          'selected': rows[best]['id'] if accepted else None,
                          'score': float(probabilities[best]),
                          'correct': bool(y[best]) if accepted else not gold,
                          'ranking': [{'id': rows[i]['id'], 'score': float(probabilities[i])} for i in ranking]})
        return cases

    baseline = json.loads(args.baseline.read_text())
    old_prob = 1 / (1 + np.exp(-np.clip(x @ baseline['coef'] + baseline['intercept'], -50, 50)))
    old_cases = evaluate(old_prob)
    cv = []
    with threadpool_limits(limits=1):
        for heldout in sorted({r['style'] for r in rows}) + [None]:
            test_hashes = {r['sha256'] for r in rows if r['style'] == heldout}
            indices = [i for i, r in enumerate(rows) if r['style'] != heldout and r['sha256'] not in test_hashes]
            indices += [i for i in template_ids if templates[i-len(rows)]['sha256'] not in test_hashes]
            head = LogisticRegression(C=10, class_weight='balanced', random_state=0, max_iter=1500).fit(x[indices], y[indices])
            probabilities = head.predict_proba(x)[:, 1]
            if heldout is not None:
                cv.extend(evaluate(probabilities, heldout))
                continue
            replay = evaluate(probabilities)
            model = {'coef': head.coef_[0].tolist(), 'intercept': float(head.intercept_[0]),
                     'feature': 'foreground spatial', 'threshold': .5,
                     'version': 'yx-shared-v3-20260921',
                     'template_contract': 'YX common functional-card template across four categories',
                     'training_positive_styles': sorted({r['style'] for r in rows if r['yx_label']}),
                     'training_styles': sorted({r['style'] for r in rows}),
                     'manifest_sha256': digest(args.manifest), 'features_sha256': digest(args.features),
                     'training_script_sha256': digest(__file__),
                     'evaluation_scope': '19-style development regression; not independent new-style acceptance'}
    def summary(cases):
        return {'groups': len(cases), 'correct': sum(c['correct'] for c in cases),
                'present': sum(bool(c['gold_ids']) for c in cases),
                'misses': sum(bool(c['gold_ids']) and c['selected'] is None for c in cases),
                'wrong_selection': sum(c['selected'] is not None and not c['correct'] for c in cases),
                'absent': sum(not c['gold_ids'] for c in cases)}
    args.output.mkdir(parents=True, exist_ok=False)
    for name, value in [('yx.json', model), ('baseline.json', old_cases), ('leave-style-out.json', cv), ('replay.json', replay)]:
        (args.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2))
    result = {'baseline': summary(old_cases), 'leave_style_out': summary(cv), 'replay': summary(replay)}
    (args.output / 'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
