"""The single, server-side OpenAI AI integration used by NexusMSP."""
from dataclasses import dataclass
import os


DEFAULT_MODEL = "gpt-5.6-terra"
ALLOWED_MODELS = {"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6"}
ALLOWED_REASONING_EFFORTS = {"none", "low", "medium", "high", "xhigh", "max"}


def normalise_model(model: str | None) -> str:
    """Keep every AI action on a supported, centrally managed OpenAI model."""
    return model if isinstance(model, str) and model in ALLOWED_MODELS else DEFAULT_MODEL


@dataclass
class UserMessage:
    text: str


class LlmChat:
    """Small compatibility layer used by NexusMSP AI features without a platform proxy."""
    def __init__(self, api_key: str | None = None, session_id: str | None = None, system_message: str | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.session_id = session_id
        self.system_message = system_message
        self.model = normalise_model(os.environ.get("NEXUS_AI_MODEL"))
        self.reasoning_effort = None

    def with_model(self, provider: str, model: str):
        # Retain this compatibility surface for existing features. The server
        # only sends requests to OpenAI; legacy provider values use the global
        # OpenAI default instead of silently selecting another vendor.
        if provider == "openai":
            self.model = normalise_model(model)
        return self

    def with_reasoning_effort(self, effort: str | None):
        if effort in ALLOWED_REASONING_EFFORTS:
            self.reasoning_effort = effort
        return self

    async def _load_global_config(self) -> tuple[str, str]:
        """Load Settings > AI for every NexusMSP AI workflow.

        Older routers still carry provider/model literals. Resolving the single
        configuration here preserves those routes while making the Settings
        choice authoritative across the product.
        """
        try:
            from app.database import db

            config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
            model = normalise_model((config or {}).get("model"))
            effort = (config or {}).get("reasoning_effort")
            return model, effort if effort in ALLOWED_REASONING_EFFORTS else "medium"
        except Exception:
            return self.model, "medium"

    async def send_message(self, message: UserMessage) -> str:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        # Keep the SDK import lazy so the settings and health routes still load
        # while a deployment is installing or upgrading optional AI packages.
        from openai import AsyncOpenAI

        model, configured_effort = await self._load_global_config()
        self.model = model
        client = AsyncOpenAI(api_key=self.api_key)
        request = {"model": model, "instructions": self.system_message or None, "input": message.text}
        effort = self.reasoning_effort or configured_effort
        if effort:
            request["reasoning"] = {"effort": effort}
        response = await client.responses.create(**request)
        return response.output_text or ""


class OpenAISpeechToText:
    def __init__(self, api_key: str | None = None):
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY", ""))

    async def transcribe(self, **kwargs):
        return await self.client.audio.transcriptions.create(**kwargs)
