"""Run the pinned PDFMathTranslate-next engine without exposing .env secrets.

Usage: .runtime/pdf2zh-next/.venv/Scripts/python.exe scripts/evaluate-pdf2zh-next.py --input FILE
Optional: --input FILE (repeatable), --pages 1-2, --output DIRECTORY, --warmup
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import logging
import sys
import time
from pathlib import Path

import fitz
from dotenv import dotenv_values
from openai import AsyncOpenAI
from pdf2zh_next.config.model import PDFSettings, SettingsModel, TranslationSettings
from pdf2zh_next.config.translate_engine_model import OpenAISettings
from pdf2zh_next.high_level import do_translate_async_stream

ROOT = Path(__file__).resolve().parents[1]


async def run(args: argparse.Namespace) -> int:
    if args.warmup:
        from babeldoc.assets.assets import async_warmup
        await async_warmup()
        print("Assets ready", flush=True)
        return 0
    if not args.input:
        raise ValueError("Provide at least one --input PDF (or use --warmup)")
    inputs = [Path(p).resolve() for p in args.input]
    for source in inputs:
        with fitz.open(source) as document:
            if len(document) > 40:
                raise ValueError(f"PDF exceeds the 40-page limit: {source.name}")
    env = dotenv_values(ROOT / ".env")
    key = env.get("API_KEY")
    if not key:
        raise ValueError("Missing API_KEY in project .env")
    base = (env.get("BASE_URL") or "https://api.deepseek.com").rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[:-len("/chat/completions")]
    model = env.get("MODEL") or "deepseek-flash"
    reasoning = env.get("REASONING") or "none"
    engine = OpenAISettings(
        openai_api_key=key, openai_base_url=base, openai_model=model,
        openai_timeout="120", openai_temperature=env.get("TEMPERATURE") or "0.2",
        openai_send_temprature=True,
        openai_reasoning_effort=None if reasoning == "omit" else reasoning,
        openai_send_reasoning_effort=reasoning != "omit",
        openai_enable_json_mode=False,
    )
    # One short request checks credentials/model compatibility before PDF processing.
    async with AsyncOpenAI(api_key=key, base_url=base, timeout=60, max_retries=0) as client:
        options = {} if reasoning == "omit" else {"reasoning_effort": reasoning}
        reply = await client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": "Translate into Chinese: residual learning"}],
            max_tokens=64, **options,
        )
        if not reply.choices or not reply.choices[0].message.content:
            raise RuntimeError("Translation API returned empty content")
    print(f"API ready: {model}", flush=True)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    settings = SettingsModel(
        translate_engine_settings=engine,
        translation=TranslationSettings(output=str(output), qps=2, pool_max_workers=4,
                                        lang_in="en", lang_out="zh", no_auto_extract_glossary=True),
        pdf=PDFSettings(pages=args.pages, translate_table_text=False,
                        watermark_output_mode="no_watermark"),
        report_interval=1,
    )
    manifest = {
        "versions": {p: importlib.metadata.version(p) for p in ("pdf2zh-next", "babeldoc", "pymupdf", "onnxruntime")},
        "model": model, "pages": args.pages, "translate_table_text": False,
        "asset_cache": str(Path.home() / ".cache" / "babeldoc"), "papers": [],
    }
    failures = 0
    for source in inputs:
        print(f"START {source.name}", flush=True)
        started = time.monotonic()
        record = {"source": str(source)}
        last_print = 0
        try:
            finished = False
            async for event in do_translate_async_stream(settings.clone(), source):
                kind = event["type"]
                if kind == "error":
                    raise RuntimeError(str(event.get("error", "Engine failed")))
                if kind == "finish":
                    result = event["translate_result"]
                    for attr in ("mono_pdf_path", "dual_pdf_path", "no_watermark_mono_pdf_path", "no_watermark_dual_pdf_path"):
                        path = getattr(result, attr, None)
                        if path:
                            record[attr] = str(path)
                    record["token_usage"] = event.get("token_usage", {})
                    record["engine_seconds"] = getattr(result, "total_seconds", None)
                    record["peak_memory_usage"] = getattr(result, "peak_memory_usage", None)
                    record["status"] = "finished"
                    finished = True
                elif kind == "progress_start" or time.monotonic() - last_print > 20:
                    print(f"{source.name}: {event.get('stage', kind)} {event.get('overall_progress', '')}", flush=True)
                    last_print = time.monotonic()
            if not finished:
                raise RuntimeError("Engine ended without a finish event")
        except Exception as exc:
            failures += 1
            # Redact the key even if an upstream exception happens to include it.
            record.update(status="failed", error=str(exc).replace(key, "[REDACTED]"))
            print(f"FAILED {source.name}: {record['error']}", flush=True)
        record["elapsed_seconds"] = round(time.monotonic() - started, 1)
        manifest["papers"].append(record)
        (output / "evaluation-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"END {source.name}: {record['status']} ({record['elapsed_seconds']}s)", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append")
    parser.add_argument("--pages")
    parser.add_argument("--output", default=str(ROOT / "tempPDF"))
    parser.add_argument("--warmup", action="store_true")
    logging.basicConfig(level=logging.WARNING)
    raise SystemExit(asyncio.run(run(parser.parse_args())))
