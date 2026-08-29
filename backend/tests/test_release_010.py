import unittest
from types import SimpleNamespace

from pydantic import ValidationError

from app.schemas import MealBody, RecipeExtractUrl, WeightBody
from app.services import auth
from app.api import _direct_loopback


class Release010Tests(unittest.TestCase):
    def setUp(self):
        auth._attempts.clear()

    def test_login_throttle_blocks_at_limit_and_can_clear(self):
        for _ in range(3):
            auth.record_login_failure("client")
        self.assertFalse(auth.login_allowed("client", 3, 300)[0])
        auth.clear_login_failures("client")
        self.assertTrue(auth.login_allowed("client", 3, 300)[0])

    def test_forwarded_loopback_is_not_physical_access(self):
        direct = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
        proxied = SimpleNamespace(headers={"x-forwarded-for": "100.64.0.2"}, client=SimpleNamespace(host="127.0.0.1"))
        self.assertTrue(_direct_loopback(direct))
        self.assertFalse(_direct_loopback(proxied))

    def test_health_inputs_are_bounded(self):
        MealBody(name="Lunch", calories=500, protein_g=40)
        WeightBody(weight_kg=75)
        with self.assertRaises(ValidationError):
            MealBody(name="Lunch", calories=-1)
        with self.assertRaises(ValidationError):
            WeightBody(weight_kg=5)

    def test_recipe_url_requires_supported_real_hostname(self):
        RecipeExtractUrl(url="https://www.youtube.com/watch?v=abcdefghijk")
        with self.assertRaises(ValidationError):
            RecipeExtractUrl(url="https://instagram.com.attacker.example/post")


if __name__ == "__main__":
    unittest.main()
