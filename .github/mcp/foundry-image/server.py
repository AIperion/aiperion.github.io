# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "mcp>=2.3,<3",
#   "azure-identity>=1.19,<2",
#   "httpx>=0.27,<1",
#   "pillow>=11,<13",
#   "python-dotenv>=1.0,<2",
# ]
# ///
"""MCP server for image generation and editing with Microsoft Foundry image models.

Supports two API families on a Foundry resource endpoint:
  openai - gpt-image-* and FLUX (Image API): /openai/v1/images/{generations,edits}
  mai    - MAI-Image-*:                      /mai/v1/images/{generations,edits}

Configuration comes from the environment, falling back to <root>/.env (see .env.example).
<root> is the working directory, which .mcp.json sets to the repository root. All input
and output paths are confined to <root>.
"""

from __future__ import annotations

import io
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

import anyio
import httpx
from dotenv import dotenv_values
from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from PIL import Image as PILImage

ROOT = Path(os.environ.get("FOUNDRY_IMAGE_ROOT") or Path.cwd()).resolve()
TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default"
REQUEST_TIMEOUT = httpx.Timeout(300.0, connect=15.0)
INPUT_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
OUTPUT_FORMATS = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
MAX_INPUT_BYTES = 50 * 1024 * 1024
MAX_INPUTS = {"openai": 16, "mai": 5}
PREVIEW_MAX_PX = 768

Family = Literal["openai", "mai"]


def _log(msg: str) -> None:
    print(f"[foundry-image] {msg}", file=sys.stderr, flush=True)


@dataclass(frozen=True)
class Settings:
    endpoint: str
    models: dict[str, Family]
    default_model: str
    tenant_id: str | None
    api_key: str | None
    output_dir: Path

    @classmethod
    def load(cls) -> "Settings":
        file_values = {k: v for k, v in dotenv_values(ROOT / ".env").items() if v is not None}

        def get(name: str) -> str | None:
            value = os.environ.get(name) or file_values.get(name)
            return value.strip() if value and value.strip() else None

        endpoint = get("FOUNDRY_ENDPOINT")
        raw_models = get("FOUNDRY_IMAGE_MODELS")
        missing = [n for n, v in (("FOUNDRY_ENDPOINT", endpoint), ("FOUNDRY_IMAGE_MODELS", raw_models)) if not v]
        if missing:
            raise ToolError(f"Missing configuration: {', '.join(missing)}. Set them in {ROOT / '.env'} (see .env.example).")
        if not endpoint.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise ToolError("FOUNDRY_ENDPOINT must be an https URL, e.g. https://<resource>.services.ai.azure.com")

        models: dict[str, Family] = {}
        for entry in (e.strip() for e in raw_models.split(",")):
            if not entry:
                continue
            name, _, family = (p.strip() for p in entry.partition("="))
            family = family.lower() or ("mai" if name.lower().startswith("mai") else "openai")
            if family not in ("openai", "mai"):
                raise ToolError(f"FOUNDRY_IMAGE_MODELS: unknown API family '{family}' for '{name}' (use openai or mai).")
            models[name] = family  # type: ignore[assignment]
        if not models:
            raise ToolError("FOUNDRY_IMAGE_MODELS lists no deployments.")

        output_dir = _confine(get("FOUNDRY_IMAGE_OUTPUT_DIR") or ".generated-images", "FOUNDRY_IMAGE_OUTPUT_DIR")
        return cls(
            endpoint=_resource_root(endpoint),
            models=models,
            default_model=next(iter(models)),
            tenant_id=get("FOUNDRY_TENANT_ID"),
            api_key=get("FOUNDRY_API_KEY"),
            output_dir=output_dir,
        )


def _resource_root(endpoint: str) -> str:
    """Image APIs live at the resource root; accept a pasted project or API URL and strip it."""
    from urllib.parse import urlsplit

    parts = urlsplit(endpoint)
    path = parts.path.rstrip("/")
    if re.match(r"^/(api/projects/[^/]+|openai|mai)(/.*)?$", path):
        path = ""
    return f"{parts.scheme}://{parts.netloc}{path}"


def _confine(path: str, label: str) -> Path:
    """Resolve a path relative to ROOT and reject anything that escapes it (including via symlinks)."""
    candidate = Path(path).expanduser()
    resolved = (candidate if candidate.is_absolute() else ROOT / candidate).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ToolError(f"{label} must be inside the workspace root {ROOT}: {path}")
    return resolved


class _TokenCache:
    def __init__(self) -> None:
        self._credential = None
        self._token: str | None = None
        self._expires_on = 0

    def get(self, tenant_id: str | None) -> str:
        if self._token and self._expires_on - time.time() > 300:
            return self._token
        from azure.identity import DefaultAzureCredential

        if self._credential is None:
            self._credential = DefaultAzureCredential(additionally_allowed_tenants=["*"])
        try:
            token = self._credential.get_token(TOKEN_SCOPE, tenant_id=tenant_id)
        except Exception as exc:  # azure-identity raises a chain-specific error type
            raise ToolError(
                "Microsoft Entra sign-in failed. Run `az login` (add `--tenant <FOUNDRY_TENANT_ID>` if the resource "
                f"lives in another tenant) or set FOUNDRY_API_KEY. Details: {str(exc).splitlines()[0]}"
            ) from exc
        self._token, self._expires_on = token.token, token.expires_on
        return self._token


_tokens = _TokenCache()


async def _auth_headers(settings: Settings) -> dict[str, str]:
    if settings.api_key:
        return {"api-key": settings.api_key}
    token = await anyio.to_thread.run_sync(_tokens.get, settings.tenant_id)
    return {"Authorization": f"Bearer {token}"}


def _url(settings: Settings, family: Family, operation: Literal["generations", "edits"]) -> str:
    if family == "mai":
        return f"{settings.endpoint}/mai/v1/images/{operation}"
    return f"{settings.endpoint}/openai/v1/images/{operation}?api-version=preview"


def _resolve_model(settings: Settings, model: str | None) -> tuple[str, Family]:
    name = model or settings.default_model
    if name not in settings.models:
        raise ToolError(f"Unknown model '{name}'. Configured deployments: {', '.join(settings.models)}.")
    return name, settings.models[name]


def _parse_size(size: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*[xX]\s*(\d+)\s*", size)
    if not match:
        raise ToolError(f"size must look like WIDTHxHEIGHT, e.g. 1024x1024 (got '{size}').")
    return int(match.group(1)), int(match.group(2))


def _api_error(response: httpx.Response) -> ToolError:
    try:
        body = response.json()
        error = body.get("error", body) if isinstance(body, dict) else body
        detail = error.get("message") or error.get("code") if isinstance(error, dict) else str(error)
    except ValueError:
        detail = response.text
    detail = (detail or response.reason_phrase or "")[:800]
    hint = ""
    if response.status_code in (401, 403):
        hint = (" Hint: assign the 'Azure AI User' role on the Foundry resource to the principal named above "
                "(Owner/Contributor do not grant data-plane access) and sign in to the resource's tenant (FOUNDRY_TENANT_ID).")
    elif response.status_code == 404:
        hint = " Hint: check the deployment name and that FOUNDRY_ENDPOINT is the https://<resource>.services.ai.azure.com endpoint."
    elif response.status_code == 429:
        hint = " Hint: rate limited — MAI image models allow only a few requests per minute on lower quota tiers."
    return ToolError(f"Foundry returned HTTP {response.status_code}: {detail}{hint}")


async def _post(settings: Settings, url: str, **kwargs) -> bytes:
    headers = await _auth_headers(settings)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            response = await client.post(url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise ToolError(f"Request to Foundry failed: {exc.__class__.__name__}: {exc}") from exc
        if response.status_code >= 400:
            raise _api_error(response)
        try:
            item = response.json()["data"][0]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ToolError(f"Unexpected response from Foundry: {response.text[:300]}") from exc
        if item.get("b64_json"):
            import base64

            return base64.b64decode(item["b64_json"])
        if item.get("url"):
            download = await client.get(item["url"])
            if download.status_code >= 400:
                raise ToolError(f"Could not download generated image: HTTP {download.status_code}")
            return download.content
        raise ToolError("Foundry response contained neither b64_json nor url.")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "image"


def _target(settings: Settings, prompt: str, output_path: str | None, overwrite: bool) -> Path:
    """Validate the destination before calling the (billed) API."""
    if output_path:
        target = _confine(output_path, "output_path")
        if target.suffix.lower() not in OUTPUT_FORMATS:
            raise ToolError(f"output_path must end in one of {', '.join(sorted(OUTPUT_FORMATS))}.")
    else:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = settings.output_dir / f"{stamp}-{_slug(prompt)}.png"
    if target.exists() and not overwrite:
        raise ToolError(f"{target.relative_to(ROOT)} already exists. Pass overwrite=true or choose another output_path.")
    return target


def _save(target: Path, data: bytes) -> PILImage.Image:
    try:
        image = PILImage.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise ToolError(f"Foundry returned data that is not a readable image: {exc}") from exc

    target.parent.mkdir(parents=True, exist_ok=True)
    fmt = OUTPUT_FORMATS[target.suffix.lower()]
    if image.format == fmt:
        target.write_bytes(data)
    else:
        to_write = image.convert("RGB") if fmt == "JPEG" and image.mode not in ("RGB", "L") else image
        to_write.save(target, format=fmt)
    return image


def _preview(image: PILImage.Image) -> Image:
    preview = image.copy()
    preview.thumbnail((PREVIEW_MAX_PX, PREVIEW_MAX_PX))
    if preview.mode in ("RGBA", "LA", "P"):
        rgba = preview.convert("RGBA")
        background = PILImage.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        preview = background
    elif preview.mode != "RGB":
        preview = preview.convert("RGB")
    buffer = io.BytesIO()
    preview.save(buffer, format="JPEG", quality=85)
    return Image(data=buffer.getvalue(), format="jpeg")


def _result(target: Path, image: PILImage.Image, model: str, started: float) -> list:
    summary = (
        f"Saved {target.relative_to(ROOT)} ({image.width}x{image.height}, {model}, "
        f"{time.monotonic() - started:.1f}s). Attached preview is downscaled to max {PREVIEW_MAX_PX}px."
    )
    return [summary, _preview(image)]


mcp = MCPServer(
    "foundry-image",
    instructions=(
        "Generate and edit images with Microsoft Foundry image models. Images are saved inside the workspace; "
        "pass output_path to place an asset directly (e.g. docs/assets/...). Call list_image_models first to see "
        "configured deployments."
    ),
)


@mcp.tool()
def list_image_models() -> str:
    """List the configured Foundry image deployments, their API family, the default model and the output folder."""
    settings = Settings.load()
    lines = [f"- {name} ({family}){' — default' if name == settings.default_model else ''}" for name, family in settings.models.items()]
    auth = "API key" if settings.api_key else "Microsoft Entra ID"
    return "\n".join([f"Endpoint: {settings.endpoint} (auth: {auth})", *lines, f"Default output folder: {settings.output_dir.relative_to(ROOT)}"])


@mcp.tool()
async def generate_image(
    prompt: str,
    model: str | None = None,
    size: str | None = None,
    quality: Literal["low", "medium", "high", "xhigh", "max", "auto"] | None = None,
    transparent_background: bool = False,
    output_path: str | None = None,
    overwrite: bool = False,
) -> list:
    """Generate an image from a text prompt with a Foundry image model.

    Args:
        prompt: Detailed description of the image.
        model: Deployment name from list_image_models; defaults to the first configured one.
        size: WIDTHxHEIGHT, e.g. 1024x1024 or 1536x1024. Allowed values depend on the model.
        quality: gpt-image models only; xhigh and max require gpt-image-2.5 models.
        transparent_background: gpt-image models only; output is PNG with alpha.
        output_path: Workspace-relative file path (.png/.jpg/.webp). Defaults to the output folder.
        overwrite: Allow replacing an existing file at output_path.
    """
    settings = Settings.load()
    name, family = _resolve_model(settings, model)
    started = time.monotonic()

    if family == "mai":
        if quality or transparent_background:
            raise ToolError("quality and transparent_background are not supported by MAI image models.")
        body: dict = {"model": name, "prompt": prompt}
        if size:
            body["width"], body["height"] = _parse_size(size)
    else:
        body = {"model": name, "prompt": prompt, "n": 1}
        if size:
            body["size"] = size
        if quality:
            body["quality"] = quality
        if transparent_background:
            body["background"] = "transparent"
            body["output_format"] = "png"

    target = _target(settings, prompt, output_path, overwrite)
    _log(f"generate model={name} family={family}")
    data = await _post(settings, _url(settings, family, "generations"), json=body)
    return _result(target, _save(target, data), name, started)


@mcp.tool()
async def edit_image(
    prompt: str,
    images: list[str],
    model: str | None = None,
    size: str | None = None,
    output_path: str | None = None,
    overwrite: bool = False,
) -> list:
    """Edit or combine existing workspace images following a text instruction.

    Args:
        prompt: What to change, e.g. "replace the background with a soft gradient".
        images: Workspace-relative paths of PNG/JPEG/WebP reference images (MAI: up to 5, gpt-image: up to 16,
            FLUX.1-Kontext: 1).
        model: Deployment name from list_image_models; defaults to the first configured one.
        size: WIDTHxHEIGHT for gpt-image/FLUX edits; not supported by MAI edits.
        output_path: Workspace-relative file path (.png/.jpg/.webp). Defaults to the output folder.
        overwrite: Allow replacing an existing file at output_path.
    """
    settings = Settings.load()
    name, family = _resolve_model(settings, model)
    started = time.monotonic()

    if not images:
        raise ToolError("Provide at least one input image.")
    if len(images) > MAX_INPUTS[family]:
        raise ToolError(f"{family} models accept at most {MAX_INPUTS[family]} input images.")
    if family == "mai" and size:
        raise ToolError("MAI image edits do not accept size; the output follows the input image.")

    files = []
    field = "image" if family == "mai" or len(images) == 1 else "image[]"
    for path in images:
        source = _confine(path, "images")
        if not source.is_file():
            raise ToolError(f"Input image not found: {path}")
        if source.suffix.lower() not in INPUT_SUFFIXES:
            raise ToolError(f"Unsupported input image type {source.suffix}: use PNG, JPEG or WebP.")
        if source.stat().st_size > MAX_INPUT_BYTES:
            raise ToolError(f"Input image exceeds 50 MB: {path}")
        mime = "image/jpeg" if source.suffix.lower() in (".jpg", ".jpeg") else f"image/{source.suffix.lower()[1:]}"
        files.append((field, (source.name, source.read_bytes(), mime)))

    form = {"model": name, "prompt": prompt}
    if family == "openai":
        form["n"] = "1"
        if size:
            form["size"] = size

    target = _target(settings, prompt, output_path, overwrite)
    _log(f"edit model={name} family={family} inputs={len(files)}")
    data = await _post(settings, _url(settings, family, "edits"), data=form, files=files)
    return _result(target, _save(target, data), name, started)


if __name__ == "__main__":
    mcp.run()
