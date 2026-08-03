from __future__ import annotations

from pydantic import BaseModel, Field as _Field


class DatabaseConfig(BaseModel):
    """Request body for switching the annotation database path."""

    path: str = _Field(min_length=1)


class AnnotationCampaignCreate(BaseModel):
    """Request body for creating or updating an annotation campaign."""

    name: str = _Field(min_length=1)
    description: str | None = None
    status: str = "active"


class LabelSetCreate(BaseModel):
    """Request body for creating or updating a campaign label set."""

    name: str = _Field(min_length=1)
    description: str | None = None
    sort_order: int = 0


class LabelCreate(BaseModel):
    """Request body for creating or updating an annotation label."""

    name: str = _Field(min_length=1)
    description: str | None = None
    color: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CampaignItemsCreate(BaseModel):
    """Request body for adding tracks or samples to a campaign."""

    track_ids: list[int] = _Field(default_factory=list)
    track_sample_ids: list[int] = _Field(default_factory=list)


class AssignmentCreate(BaseModel):
    """Request body for assigning a label to one track sample."""

    track_sample_id: int
    label_id: int
    annotator: str | None = None
    confidence: float | None = _Field(default=None, ge=0.0, le=1.0)
    notes: str | None = None
