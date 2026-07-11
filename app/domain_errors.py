class DomainError(Exception):
    code = "domain_error"
    http_status = 422

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class DomainConflict(DomainError):  # noqa: N818 - stable domain API name
    code = "version_conflict"
    http_status = 409


class InactiveAssignmentTarget(DomainError):  # noqa: N818 - stable domain API name
    code = "inactive_assignment_target"


class StudentNotFound(DomainError):  # noqa: N818 - stable domain API name
    code = "student_not_found"
