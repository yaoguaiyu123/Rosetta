"""Run with the configured engine's Python; no external network or paid API calls."""
import importlib.util
import json
from pathlib import Path
import unittest
import httpx
import openai
from pdf2zh_next.config.model import SettingsModel
from pdf2zh_next.translator.translator_impl.openai import OpenAITranslator
from pdf2zh_next.translator.base_rate_limiter import BaseRateLimiter

spec = importlib.util.spec_from_file_location("rosetta_worker", Path(__file__).resolve().parents[1] / "scripts/pdf2zh-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class MiMoWorkerTest(unittest.TestCase):
    def test_real_sdk_payload_through_engine(self):
        for provider, reasoning, expected in [("mimo", "none", "disabled"), ("mimo", "high", "enabled"), ("mimo", "omit", None), ("deepseek", "none", None)]:
            with self.subTest(provider=provider, reasoning=reasoning):
                config = {"apiKey": "mock-key-for-testing", "model": "mimo-v2.6-flash" if provider == "mimo" else "deepseek-flash", "baseUrl": "https://api.xiaomimimo.com/v1" if provider == "mimo" else "https://api.deepseek.com/v1", "reasoning": reasoning}
                engine = worker.build_engine(config)
                settings = SettingsModel(translate_engine_settings=engine)
                translator = OpenAITranslator(settings, BaseRateLimiter())
                def respond(request):
                    payload = json.loads(request.content)
                    if expected:
                        self.assertEqual(payload["thinking"], {"type": expected})
                        self.assertNotIn("reasoning_effort", payload)
                    elif provider == "deepseek":
                        self.assertEqual(payload["reasoning_effort"], "none")
                    else:
                        self.assertNotIn("thinking", payload)
                        self.assertNotIn("reasoning_effort", payload)
                    self.assertEqual(request.headers["authorization"], "Bearer mock-key-for-testing")
                    return httpx.Response(200, json={"id":"test", "object":"chat.completion", "created":1, "model":config["model"], "choices":[{"index":0,"message":{"role":"assistant","content":"translated"},"finish_reason":"stop"}]})
                with translator.client:
                    translator.client = openai.OpenAI(base_url=config["baseUrl"], api_key=config["apiKey"], http_client=httpx.Client(transport=httpx.MockTransport(respond)))
                with translator.client:
                    self.assertEqual(translator.do_translate("Test sentence."), "translated")

if __name__ == "__main__":
    unittest.main()
