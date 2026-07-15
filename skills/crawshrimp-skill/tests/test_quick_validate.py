import tempfile
import unittest
from pathlib import Path

import quick_validate


def make_skill_root(tmpdir: str, skill_text: str) -> Path:
    root = Path(tmpdir)
    for relative in quick_validate.REQUIRED_FILES:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("placeholder\n", encoding="utf-8")
    (root / "SKILL.md").write_text(skill_text, encoding="utf-8")
    return root


VALID_SKILL = """---
name: crawshrimp-skill
description: Use when an AI agent needs to operate live webpages.
---

observe act verify journal distill dangerous 9222 API-first page-owned API request path double verification
"""


class QuickValidateTest(unittest.TestCase):
    def test_requires_enterprise_form_workflow_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_skill_root(tmp, VALID_SKILL)
            enterprise_reference = root / "references/enterprise-form-workflows.md"
            if enterprise_reference.exists():
                enterprise_reference.unlink()

            errors = quick_validate.validate(root)

        self.assertIn(
            "missing required file: references/enterprise-form-workflows.md",
            errors,
        )

    def test_requires_global_9222_and_api_first_terms(self):
        skill_text = """---
name: crawshrimp-skill
description: Use when an AI agent needs to operate live webpages.
---

observe act verify journal distill dangerous
"""
        with tempfile.TemporaryDirectory() as tmp:
            root = make_skill_root(tmp, skill_text)

            errors = quick_validate.validate(root)

        self.assertIn("SKILL.md missing term: 9222", errors)
        self.assertIn("SKILL.md missing term: API-first", errors)
        self.assertIn("SKILL.md missing term: page-owned API", errors)
        self.assertIn("SKILL.md missing term: request path", errors)
        self.assertIn("SKILL.md missing term: double verification", errors)

    def test_requires_proactive_connection_refused_recovery_terms(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_skill_root(tmp, VALID_SKILL)

            errors = quick_validate.validate(root)

        self.assertIn("SKILL.md missing term: connection refused", errors)
        self.assertIn("SKILL.md missing term: dedicated Chrome", errors)
        self.assertIn(
            "references/browser-execution.md missing recovery term: connection refused",
            errors,
        )
        self.assertIn(
            "references/browser-execution.md missing recovery term: remote-debugging-port=9222",
            errors,
        )


if __name__ == "__main__":
    unittest.main()
