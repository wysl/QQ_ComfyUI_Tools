"""Configuration loading for the Grok Imagine image node.

The file intentionally lives outside the repository by default so API keys are
not copied into workflows or committed to source control.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class GrokImageProfile:
    name: str
    endpoint: str
    api_key: str = ""
    model: str = "grok-imagine-image-2.0"
    edits_endpoint: str = ""
    allow_nsfw: bool = False


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[1]


def config_candidates() -> tuple[Path, ...]:
    candidates: list[Path] = []
    configured = (
        os.environ.get("QQ_GROK_IMAGE_CONFIG", "").strip()
        or os.environ.get("WYSL_GROK_IMAGE_CONFIG", "").strip()
    )
    if configured:
        candidates.append(Path(configured).expanduser())

    try:
        import folder_paths

        user_directory = getattr(folder_paths, "get_user_directory", None)
        if callable(user_directory):
            user_root = Path(user_directory())
            candidates.append(user_root / "QQ_ComfyUI_Tools" / "grok_image_endpoints.json")
            candidates.append(user_root / "Wysl_ComfyUI_Tools" / "grok_image_endpoints.json")
    except Exception:
        pass

    candidates.append(_repository_root() / "config" / "grok_image_endpoints.json")
    # Keep order stable while avoiding duplicate paths from an environment
    # variable that points at the normal user configuration location.
    result: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve(strict=False)).casefold()
        if key not in seen:
            result.append(path)
            seen.add(key)
    return tuple(result)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "enabled"}
    return bool(value)


def _profile_from_mapping(value: Any, index: int) -> GrokImageProfile:
    if not isinstance(value, dict):
        raise ValueError(f"第 {index + 1} 个 Grok 配置必须是对象")
    name = str(value.get("name", "")).strip()
    endpoint = str(value.get("endpoint", value.get("generations_endpoint", ""))).strip()
    if not name:
        raise ValueError(f"第 {index + 1} 个 Grok 配置缺少 name")
    if not endpoint:
        raise ValueError(f"Grok 配置“{name}”缺少 endpoint")
    return GrokImageProfile(
        name=name,
        endpoint=endpoint,
        api_key=str(value.get("api_key", value.get("apiKey", "")) or "").strip(),
        model=str(value.get("model", "grok-imagine-image-2.0") or "grok-imagine-image-2.0").strip(),
        edits_endpoint=str(value.get("edits_endpoint", value.get("editsEndpoint", "")) or "").strip(),
        allow_nsfw=_as_bool(value.get("allow_nsfw", value.get("allowNSFW", False))),
    )


def load_profiles() -> tuple[tuple[GrokImageProfile, ...], Path | None]:
    """Load profiles and return the source path for useful error messages."""
    for path in config_candidates():
        if not path.is_file():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"读取 Grok 图片配置失败：{path}：{exc}") from exc

        if isinstance(raw, dict):
            raw_profiles = raw.get("profiles", raw.get("endpoints", []))
        else:
            raw_profiles = raw
        if not isinstance(raw_profiles, list):
            raise ValueError(f"Grok 图片配置必须包含 profiles 数组：{path}")

        profiles: list[GrokImageProfile] = []
        seen_names: set[str] = set()
        for index, value in enumerate(raw_profiles):
            profile = _profile_from_mapping(value, index)
            if profile.name in seen_names:
                raise ValueError(f"Grok 图片配置存在重复 name：{profile.name}")
            seen_names.add(profile.name)
            profiles.append(profile)
        return tuple(profiles), path
    return (), None


def profile_names() -> list[str]:
    try:
        profiles, _ = load_profiles()
    except ValueError:
        # Keep ComfyUI's node catalogue usable when a user is editing the
        # external file. Execution still reports the precise configuration
        # error through ``find_profile``.
        return ["Grok 配置错误（请检查配置文件）"]
    return [profile.name for profile in profiles] or ["未配置 Grok endpoint"]


def find_profile(name: str) -> GrokImageProfile:
    profiles, source = load_profiles()
    for profile in profiles:
        if profile.name == name:
            return profile
    location = str(source) if source else str(config_candidates()[0])
    raise ValueError(f"未找到 Grok 配置“{name}”。请在 {location} 配置 profiles")
