"""Errors raised by the account / directory services (no FastAPI dependencies).

Routers translate them to the responses these endpoints have always returned:
``UserRequestError`` -> ``Response.error(code=1)`` (HTTP 200) and
``UserForbidden`` -> HTTP 403 with ``{"detail": ...}``.
"""


class UserRequestError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class UserForbidden(Exception):  # noqa: N818 - mirrors the HTTP 403 it becomes
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
