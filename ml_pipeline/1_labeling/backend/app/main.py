from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import annotation_repositories as repo
from .config import cors_origins
from .db import get_database_path, init_annotation_db, set_database_path
from .schemas import AssignmentCreate, AnnotationCampaignCreate, CampaignItemsCreate, DatabaseConfig, LabelCreate, LabelSetCreate

app = FastAPI(title="Street Parade Annotation API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_annotation_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": str(get_database_path())}


@app.get("/config/database")
def get_database_config() -> dict[str, str]:
    return {"path": str(get_database_path())}


@app.post("/config/database")
def configure_database(payload: DatabaseConfig) -> dict[str, str]:
    return {"path": str(set_database_path(payload.path))}


@app.post("/annotation_campaign")
def create_annotation_campaign(payload: AnnotationCampaignCreate) -> dict[str, Any]:
    return repo.create_annotation_campaign(payload.name, payload.description, payload.status)


@app.get("/annotation_campaign")
def list_annotation_campaigns() -> list[dict[str, Any]]:
    return repo.list_annotation_campaigns()


@app.get("/annotation_campaign/{campaign_id}")
def get_annotation_campaign(campaign_id: int) -> dict[str, Any]:
    return repo.get_annotation_campaign(campaign_id)


@app.post("/annotation_campaign/{campaign_id}/label-sets")
def create_label_set(campaign_id: int, payload: LabelSetCreate) -> dict[str, Any]:
    return repo.create_label_set(campaign_id, payload.name, payload.description, payload.sort_order)


@app.get("/annotation_campaign/{campaign_id}/label-sets")
def list_label_sets(campaign_id: int) -> list[dict[str, Any]]:
    return repo.list_label_sets(campaign_id)


@app.post("/label-sets/{label_set_id}/labels")
def create_label(label_set_id: int, payload: LabelCreate) -> dict[str, Any]:
    return repo.create_label(label_set_id, payload.name, payload.description, payload.color, payload.sort_order, payload.is_active)


@app.get("/label-sets/{label_set_id}/labels")
def list_labels(label_set_id: int) -> list[dict[str, Any]]:
    return repo.list_labels(label_set_id)


@app.post("/annotation_campaign/{campaign_id}/items")
def add_campaign_items(campaign_id: int, payload: CampaignItemsCreate) -> list[dict[str, Any]]:
    return repo.add_campaign_items(campaign_id, payload.track_ids, payload.track_sample_ids)


@app.get("/annotation_campaign/{campaign_id}/items")
def list_campaign_items(campaign_id: int) -> list[dict[str, Any]]:
    return repo.list_campaign_items(campaign_id)


@app.delete("/annotation_campaign/{campaign_id}/items/{item_id}")
def remove_campaign_item(campaign_id: int, item_id: int) -> dict[str, Any]:
    return repo.remove_campaign_item(campaign_id, item_id)


@app.get("/annotation_campaign/{campaign_id}/samples")
def list_campaign_samples(campaign_id: int) -> list[dict[str, Any]]:
    return repo.list_campaign_samples(campaign_id)


@app.post("/annotation_campaign/{campaign_id}/assignments")
def assign_label(campaign_id: int, payload: AssignmentCreate) -> dict[str, Any]:
    return repo.assign_label(campaign_id, payload.track_sample_id, payload.label_id, payload.annotator, payload.confidence, payload.notes)


@app.get("/annotation_campaign/{campaign_id}/assignments")
def list_assignments(campaign_id: int) -> list[dict[str, Any]]:
    return repo.list_assignments(campaign_id)


@app.delete("/assignments/{assignment_id}")
def remove_assignment(assignment_id: int) -> dict[str, Any]:
    return repo.remove_assignment(assignment_id)


@app.get("/tracks")
def list_tracks(page: int = Query(default=1, ge=1), page_size: int = Query(default=100, ge=1)) -> dict[str, Any]:
    return repo.list_tracks(page=page, page_size=page_size)


@app.get("/tracks/{track_id}/samples")
def list_track_samples(track_id: int) -> list[dict[str, Any]]:
    return repo.list_track_samples(track_id)


@app.get("/tracks/{track_id}/audio")
def get_track_audio(track_id: int) -> FileResponse:
    path = Path(repo.get_track_path(track_id))
    return FileResponse(path, media_type="audio/mpeg")
