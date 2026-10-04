"""One local engine job. Configuration arrives through stdin, never command arguments."""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path


def emit(kind: str, **data):
    print(json.dumps({"type": kind, **data}, ensure_ascii=False), flush=True)


async def translate(request):
    import fitz
    source = Path(request["input"])
    with fitz.open(source) as doc:
        pages = len(doc)
        if pages > 40:
            raise ValueError(f"这份 PDF 有 {pages} 页，全文翻译最多支持 40 页。")
        if pages < 1:
            raise ValueError("PDF 没有可读取的页面。")
        if doc.needs_pass:
            raise ValueError("请先解锁加密 PDF，再进行全文翻译。")
    emit("progress", stage="preparing", percent=0, detail="正在准备翻译", pages=pages)
    from pdf2zh_next.config.model import PDFSettings, SettingsModel, TranslationSettings
    from pdf2zh_next.config.translate_engine_model import OpenAISettings
    from pdf2zh_next.high_level import do_translate_async_stream
    config = request["config"]
    base = str(config.get("baseUrl") or "https://api.deepseek.com/v1").rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[:-len("/chat/completions")]
    elif not base.endswith("/v1") and base.count("/") == 2:
        base += "/v1"
    reasoning = config.get("reasoning", "none")
    engine = OpenAISettings(
        openai_base_url=base, openai_api_key=config["apiKey"],
        openai_model=config.get("model") or "deepseek-flash",
        openai_timeout="120", openai_temperature=str(config.get("temperature", 0.3)),
        openai_send_temprature=True, openai_enable_json_mode=False,
        openai_reasoning_effort=None if reasoning == "omit" else reasoning,
        openai_send_reasoning_effort=reasoning != "omit",
    )
    settings = SettingsModel(
        translate_engine_settings=engine,
        translation=TranslationSettings(
            output=request["output"], lang_in="en", lang_out="zh",
            qps=2, pool_max_workers=4, no_auto_extract_glossary=True,
            ignore_cache=bool(request.get("replace")),
        ),
        pdf=PDFSettings(translate_table_text=False, watermark_output_mode="no_watermark"),
        report_interval=1,
    )
    labels = {
        "Parse PDF and Create Intermediate Representation": "正在读取 PDF",
        "DetectScannedFile": "正在检查文字层",
        "Parse Page Layout": "正在识别页面布局",
        "Parse Paragraphs": "正在识别段落",
        "Parse Formulas and Styles": "正在识别公式与样式",
        "Translate Paragraphs": "正在翻译正文",
        "Typesetting": "正在排版译文",
        "Add Fonts": "正在嵌入字体",
        "Generate drawing instructions": "正在生成页面",
        "Subset font": "正在优化字体",
        "Save PDF": "正在生成 PDF",
    }
    finished = False
    async for event in do_translate_async_stream(settings, source):
        kind = event["type"]
        if kind == "error":
            raise RuntimeError(str(event.get("error", "翻译引擎运行失败")))
        if kind.startswith("progress"):
            stage = event.get("stage", "")
            if stage:
                emit("progress", stage=stage, detail=labels.get(stage, "正在处理页面"),
                     percent=min(99, max(0, float(event.get("overall_progress") or 0))), pages=pages)
        if kind == "finish":
            result = event["translate_result"]
            mono = getattr(result, "no_watermark_mono_pdf_path", None) or result.mono_pdf_path
            dual = getattr(result, "no_watermark_dual_pdf_path", None) or result.dual_pdf_path
            if not mono or not dual:
                raise RuntimeError("引擎没有生成完整的中文和中英对照译本。")
            # Verify real PDFs and the output mode before reporting success.
            with fitz.open(mono) as m, fitz.open(dual) as d:
                if len(m) != pages or len(d) != pages:
                    raise RuntimeError("译本页数验证失败。")
                if abs(d[0].rect.width - m[0].rect.width * 2) > 2:
                    raise RuntimeError("中英对照译本的页面宽度验证失败。")
            emit("finish", mono=str(mono), dual=str(dual), pages=pages,
                 seconds=getattr(result, "total_seconds", None),
                 tokens=event.get("token_usage", {}))
            finished = True
    if not finished:
        raise RuntimeError("翻译任务未生成结果。")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    request = {}
    try:
        request = json.loads(sys.stdin.readline())
        asyncio.run(translate(request))
    except Exception as exc:
        message = str(exc)
        key = request.get("config", {}).get("apiKey", "")
        if key:
            message = message.replace(key, "[REDACTED]")
        emit("error", error=message[:2000])
        raise SystemExit(1)
