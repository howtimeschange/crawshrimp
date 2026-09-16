"""Quality accounting keeps false rejects, unknowns and missing outputs visible."""
from __future__ import annotations

VERSION = 'shoe-quality-v1'


def summarize(cases, *, expected_outputs=None):
    positives=[c for c in cases if c.get('truth') is True]
    negatives=[c for c in cases if c.get('truth') is False]
    false_accepts=[c for c in negatives if c.get('accepted') is True]
    false_rejects=[c for c in positives if c.get('accepted') is False and c.get('status')!='review_unknown']
    unknown=[c for c in cases if c.get('status')=='review_unknown' or c.get('accepted') is None]
    outputs=[c for c in cases if c.get('delivered')]
    correct=[c for c in outputs if c.get('visual_verdict')=='correct']
    wrong=[c for c in outputs if c.get('visual_verdict')=='wrong']
    expected=expected_outputs if expected_outputs is not None else len([c for c in cases if c.get('required')])
    return {'schema':VERSION,'positive_cases':len(positives),'negative_cases':len(negatives),
            'false_accepts':len(false_accepts),'false_accept_rate':len(false_accepts)/len(negatives) if negatives else None,
            'false_rejects':len(false_rejects),'false_reject_rate':len(false_rejects)/len(positives) if positives else None,
            'unknown_cases':len(unknown),'expected_outputs':expected,'delivered_outputs':len(outputs),
            'correct_outputs':len(correct),'wrong_outputs':len(wrong),
            'visual_review_pending':len(outputs)-len(correct)-len(wrong),
            'delivery_coverage':len(outputs)/expected if expected else None,
            'correct_coverage':len(correct)/expected if expected else None,
            'delivered_accuracy':len(correct)/len(outputs) if outputs else None}
