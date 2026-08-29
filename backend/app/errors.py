"""Stable API error responses shared by middleware and exception handlers."""
from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or uuid4().hex


def error_response(request: Request, status: int, code: str, message: str, details=None, headers=None):
    rid = request_id(request)
    response = JSONResponse(
        {"error": {"code": code, "message": message, "details": details, "request_id": rid}},
        status_code=status,
        headers=headers,
    )
    response.headers["X-Request-ID"] = rid
    return response


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        detail = exc.detail
        message = detail if isinstance(detail, str) else "Request failed"
        return error_response(request, exc.status_code, f"http_{exc.status_code}", message, detail if not isinstance(detail, str) else None, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in item["loc"][1:]), "message": item["msg"]} for item in exc.errors()]
        return error_response(request, 422, "validation_error", "Check the highlighted values and try again.", details)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        request.app.state.log.exception("Unhandled request error [%s]", request_id(request), exc_info=exc)
        return error_response(request, 500, "internal_error", "Pulse could not complete that request.")
