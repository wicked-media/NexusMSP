"""Provider-neutral OpenAI-compatible AI helpers for NexusMSP."""
from dataclasses import dataclass
import os
from openai import AsyncOpenAI


@dataclass
class UserMessage:
    text: str


class LlmChat:
    """Small compatibility layer used by NexusMSP AI features without a platform proxy."""
    def __init__(self, api_key: str | None = None, session_id: str | None = None, system_message: str | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.session_id = session_id
        self.system_message = system_message
        self.model = os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini")

    def with_model(self, provider: str, model: str):
        # Only OpenAI models are accepted by the direct SDK integration. Old
        # provider settings fall back safely to the configured local default.
        if provider == "openai" and model.startswith("gpt-"):
            self.model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        messages = []
        if self.system_message:
            messages.append({"role": "system", "content": self.system_message})
        messages.append({"role": "user", "content": message.text})
        client = AsyncOpenAI(api_key=self.api_key)
        response = await client.chat.completions.create(model=self.model, messages=messages)
        return response.choices[0].message.content or ""


class OpenAISpeechToText:
    def __init__(self, api_key: str | None = None):
        self.client = AsyncOpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY", ""))

    async def transcribe(self, **kwargs):
        return await self.client.audio.transcriptions.create(**kwargs)
