"""Model package. Importing it registers every table on `Base.metadata`
(Alembic autogenerate and the test bootstrap both rely on that).
"""
from app.models.assistant import AssistantMemory, AssistantTask
from app.models.base import Base
from app.models.credential import Credential, CredentialStatus, CredentialType
from app.models.execution import Execution, ExecutionStatus
from app.models.profile import Profile
from app.models.refresh_token import RefreshToken
from app.models.service_config import ServiceConfig
from app.models.system_event import EventSeverity, SystemEvent
from app.models.user import User, UserRole, UserStatus
from app.models.workflow import Workflow, WorkflowStatus

__all__ = [
    "AssistantMemory",
    "AssistantTask",
    "Base",
    "Credential",
    "CredentialStatus",
    "CredentialType",
    "Execution",
    "ExecutionStatus",
    "Profile",
    "RefreshToken",
    "ServiceConfig",
    "EventSeverity",
    "SystemEvent",
    "User",
    "UserRole",
    "UserStatus",
    "Workflow",
    "WorkflowStatus",
]
