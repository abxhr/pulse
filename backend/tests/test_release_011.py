import json
import unittest

from starlette.requests import Request

from app.errors import error_response
from app.main import _request_id


class Release011Tests(unittest.TestCase):
    def request(self):
        scope = {"type": "http", "method": "GET", "path": "/api/test", "headers": []}
        request = Request(scope)
        request.state.request_id = "release011request"
        return request

    def test_stable_error_envelope_and_request_id(self):
        response = error_response(self.request(), 422, "validation_error", "Check values", [{"field": "weight_kg"}])
        body = json.loads(response.body)
        self.assertEqual(body["error"]["code"], "validation_error")
        self.assertEqual(body["error"]["request_id"], "release011request")
        self.assertEqual(response.headers["x-request-id"], "release011request")
        self.assertNotIn("traceback", response.body.decode().lower())

    def test_request_id_rejects_header_injection(self):
        safe = Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"x-request-id", b"client-123")]})
        unsafe = Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"x-request-id", b"bad value") ]})
        self.assertEqual(_request_id(safe), "client-123")
        self.assertNotEqual(_request_id(unsafe), "bad value")


if __name__ == "__main__":
    unittest.main()
