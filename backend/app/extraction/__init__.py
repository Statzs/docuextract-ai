from app.config import get_settings
from app.extraction.base import Extractor
from app.extraction.demo import DemoExtractor


def get_extractor() -> Extractor:
    s = get_settings()
    if s.demo_mode:
        return DemoExtractor()
    from app.extraction.gemini import GeminiExtractor

    return GeminiExtractor(s.gemini_api_key, s.gemini_model, s.gemini_timeout_seconds)
