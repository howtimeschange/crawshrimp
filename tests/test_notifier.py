import unittest

from core import notifier


class NotifierConditionTests(unittest.TestCase):
    def test_should_notify_supports_basic_data_length_condition(self):
        self.assertTrue(notifier.should_notify("data.length > 0", [{"id": 1}]))
        self.assertFalse(notifier.should_notify("data.length > 1", [{"id": 1}]))
        self.assertTrue(notifier.should_notify("data.length >= 1 && data.length < 3", [{"id": 1}]))
        self.assertFalse(notifier.should_notify("data.length > 1 || data.length == 0", [{"id": 1}]))
        self.assertTrue(notifier.should_notify("data.length > 1 || data.length == 1", [{"id": 1}]))
        self.assertFalse(notifier.should_notify("data.length > 1 && data.length < 3 || data.length == 1", [{}, {}, {}, {}]))

    def test_should_notify_does_not_execute_python_expressions(self):
        class Trap:
            touched = False

        notifier.should_notify("setattr(data[0], 'touched', True) or True", [Trap])

        self.assertFalse(Trap.touched)


if __name__ == "__main__":
    unittest.main()
