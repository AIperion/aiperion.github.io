# foundry-image MCP server

Image generation and editing for coding agents with **Microsoft Foundry** image models — the in-tenant counterpart to Google's Nano Banana. Registered as `foundry-image` in the repository's [`.mcp.json`](../../../.mcp.json), so VS Code (Copilot), GitHub Copilot CLI and Claude Code pick it up.

## Tools

| Tool | Purpose |
| ---- | ------- |
| `list_image_models` | Configured deployments, API family, default model, output folder |
| `generate_image` | Text → image. `size` (`WIDTHxHEIGHT`), `quality` (`low`…`high`, plus `xhigh`/`max` on gpt-image-2.5) and `transparent_background` (gpt-image only), `output_path` |
| `edit_image` | Image(s) + instruction → image. Inputs are workspace files (MAI ≤ 5, gpt-image ≤ 16, FLUX.1-Kontext 1) |

Every result is saved inside the repository (default `.generated-images/`, gitignored; pass `output_path` such as `docs/assets/img/hero.png` to place an asset directly) and returned to the agent as a downscaled JPEG preview so it can check the result visually.

## Supported models

| API family | Models | Endpoint used |
| ---------- | ------ | ------------- |
| `mai` | MAI-Image-2.6 / 2.6-Flash / 2.5 / 2.5-Pro / 2.5-Flash | `/mai/v1/images/{generations,edits}` |
| `openai` | gpt-image-2 / 2.5-* / 1.5 / 1 / 1-mini, FLUX.1-Kontext-pro, FLUX-1.1-pro | `/openai/v1/images/{generations,edits}?api-version=preview` |

FLUX.2 models are only reachable through the BFL provider API and are not supported.

## Setup

1. **Deploy a model** in a Foundry resource (Global Standard), e.g.:

   ```bash
   az cognitiveservices account deployment create -g <rg> -n <resource> \
     --deployment-name MAI-Image-2.6 --model-format Microsoft \
     --model-name MAI-Image-2.6 --model-version 2026-07-31 \
     --sku-name GlobalStandard --sku-capacity 1
   ```

2. **Grant yourself data-plane access** — *Owner/Contributor are not enough*. *Azure AI User* is Foundry's least-privilege developer role (unlike *Cognitive Services User* it cannot list API keys); *Azure AI Developer* also works:

   ```bash
   az role assignment create --role "Azure AI User" \
     --assignee-object-id <your-object-id-in-the-resource-tenant> --assignee-principal-type User \
     --scope <resource-id>
   ```

   The object ID to use is the one in the 401 message (`The principal '<id>' lacks …`) — for guest accounts it differs from your home-tenant ID.

3. **Sign in** with `az login` (use `--tenant <tenant-id>` when the resource lives in another tenant).
4. **Configure** the repo-root `.env` (copy from [`.env.example`](../../../.env.example)):

   ```dotenv
   FOUNDRY_ENDPOINT=https://<resource>.services.ai.azure.com   # a pasted project URL (…/api/projects/<p>) also works
   FOUNDRY_IMAGE_MODELS=MAI-Image-2.6,gpt-image-2
   FOUNDRY_TENANT_ID=<tenant-id>   # only if different from your default az login tenant
   ```

   `FOUNDRY_IMAGE_MODELS` lists deployment names; the first is the default. The API family is inferred (`mai*` → `mai`, everything else → `openai`) or set explicitly with `name=mai|openai`.

5. Restart the agent harness and trust the workspace. Requires [`uv`](https://docs.astral.sh/uv/) (`brew install uv`); dependencies are declared inline in `server.py` and resolved by `uv run --script`.

## Security

- **Microsoft Entra ID by default** (`DefaultAzureCredential` → your `az login`); `FOUNDRY_API_KEY` is an optional fallback.
- **Workspace-confined paths**: input images and `output_path` must resolve inside the repository, so a prompt-injected agent cannot upload arbitrary local files (e.g. `~/.ssh`) to the model.
- **No silent overwrites**: existing files are only replaced with `overwrite=true`; paths are validated *before* the billed API call.
- Each call is billed per image by the Foundry resource; MAI quota tier 0 allows 0 requests/minute — request quota if calls are rejected with 429.

## Troubleshooting

| Error | Fix |
| ----- | --- |
| `Missing configuration: FOUNDRY_ENDPOINT…` | Fill in `.env` at the repo root. |
| `Microsoft Entra sign-in failed` | `az login --tenant <tenant-id>`, or set `FOUNDRY_TENANT_ID`. |
| HTTP 401 `lacks the required data action` / `Principal does not have access to API/Operation` | Assign *Azure AI User* (or *Azure AI Developer*) on the resource to the principal ID named in the message. A new assignment can take **~10 minutes** to reach every endpoint — `/models` may already answer while `/images/*` still returns 401. |
| HTTP 404 | Deployment name typo, or endpoint is not the `services.ai.azure.com` one. |
| HTTP 429 | Rate/quota limit — MAI models allow only a few requests per minute on low tiers. |
| `uv: command not found` | Install uv; GUI-launched editors need it on their `PATH`. |
