from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

SplitStrategy = Literal["group", "chronological", "stratified", "random"]


class TrainConfig(BaseModel):
    dataset_id: int
    features: list[str] = Field(min_length=1, max_length=50)
    target: str = Field(min_length=1)
    test_size: float = Field(default=0.25, ge=0.1, le=0.5)
    random_seed: int = Field(default=42, ge=0, le=2**31 - 1)
    n_estimators: int = Field(default=200, ge=10, le=1000)
    max_depth: Optional[int] = Field(default=None, ge=1, le=100)
    min_samples_split: int = Field(default=2, ge=2, le=100)
    min_samples_leaf: int = Field(default=1, ge=1, le=100)
    class_weight: Literal["none", "balanced", "balanced_subsample"] = "none"
    split_strategy: SplitStrategy = "group"
    group_column: Optional[str] = None
    time_column: Optional[str] = None
    model_name: str = Field(default="RandomForest", min_length=1, max_length=80)
    notes: str = Field(default="", max_length=2000)
    acknowledge_warnings: bool = False

    @field_validator("features")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("features must be unique")
        return v


class PredictRequest(BaseModel):
    features: Optional[dict[str, Optional[float]]] = None
    use_latest: bool = False
    device_id: Optional[str] = None
