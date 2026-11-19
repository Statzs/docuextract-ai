from app.config import get_settings
from app.extraction.base import Extractor


def get_ai_extractor() -> Extractor:
    from app.extraction.gemini import GeminiExtractor

    s = get_settings()
    return GeminiExtractor(s.gemini_api_key, s.gemini_model, s.gemini_timeout_seconds)
