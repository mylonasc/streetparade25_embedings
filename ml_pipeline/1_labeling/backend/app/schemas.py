from __future__ import annotations

from pydantic import BaseModel, Field


class DatabaseConfig(BaseModel):
    path: str = Field(min_length=1)


class AnnotationCampaignCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    status: str = "active"


class LabelSetCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    sort_order: int = 0


class LabelCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    color: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CampaignItemsCreate(BaseModel):
    track_ids: list[int] = Field(default_factory=list)
    track_sample_ids: list[int] = Field(default_factory=list)


class AssignmentCreate(BaseModel):
    track_sample_id: int
    label_id: int
    annotator: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    notes: str | None = None
