from __future__ import annotations

import base64
import json
import mimetypes
import re
import os
import io
import time
import logging
from collections import OrderedDict
from decimal import Decimal, InvalidOperation

import requests
from pathlib import Path
from typing import Any, List

from pypdf import PdfReader
import fitz
from PIL import Image, ImageOps
import cv2
import numpy as np
try:
    import pytesseract
except ImportError:  # pragma: no cover - optional local OCR engine
    pytesseract = None
try:
    import zxingcpp
except ImportError:  # pragma: no cover - optional QR engine
    zxingcpp = None

try:
    from pyzbar.pyzbar import decode as zbar_decode
except ImportError:  # pragma: no cover - depends on host shared library availability
    def zbar_decode(_image):
        return []


try:
    from pylibdmtx.pylibdmtx import decode as dmtx_decode
except ImportError:  # pragma: no cover - depends on host shared library availability
    def dmtx_decode(_image):
        return []

from .config import get_settings
from .ai_client import chat_completion as ai_chat_completion
from .middleware import get_module_context
from .database import SessionLocal
from .models import VendorProfile

settings = get_settings()
logger = logging.getLogger(__name__)
_qr_detector = cv2.QRCodeDetector()
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

EXTRACTION_PROMPT_BASE = (
    "Extract invoice data and return strict JSON only. "
    "Fields: vendor, supplier_nif, vendor_address, vendor_contact, customer_name, customer_nif, "
    "invoice_number, invoice_date, due_date, currency, subtotal, tax, total, notes, line_items. "
    "Rules: vendor/supplier is the invoice issuer; customer is the billed entity; never swap them. "
    "Extract all visible item-table rows; ignore summary/tax/payment-only rows. "
    "line_items elements must include code, description, quantity, unit_price, subtotal, tax_amount, total, tax_rate. "
    "Use null for missing values. Keep notes short."
)

CORRECTION_PROMPT_SUFFIX = (
    "Re-run extraction applying the corrections while keeping all other valid fields unchanged. "
    "Return full strict JSON only."
)

JSON_REPAIR_PROMPT = (
    "Convert the malformed JSON-like invoice extraction below into valid strict JSON only. "
    "No markdown, comments, or extra text."
)


def _usage_dict() -> dict[str, int]:
    return {"input": 0, "output": 0, "total": 0}


def _request_ai_headers() -> dict[str, str] | None:
    try:
        ctx = get_module_context()
    except Exception:
        return None
    return {
        "X-Viao-User-Id": ctx.user_id,
        "X-Viao-Tenant-Id": ctx.tenant_id,
        "X-Viao-Module-Key": "contabilidade",
        "X-Viao-Request-Id": ctx.request_id,
    }


def _accumulate_usage(target: dict[str, int], delta: dict[str, int] | None) -> dict[str, int]:
    if not delta:
        return target
    target["input"] += int(delta.get("input", 0) or 0)
    target["output"] += int(delta.get("output", 0) or 0)
    target["total"] += int(delta.get("total", 0) or 0)
    return target


def _usage_from_response(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None) or {}
    input_tokens = getattr(usage, "input_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None)
    total_tokens = getattr(usage, "total_tokens", None)
    if isinstance(usage, dict):
        input_tokens = usage.get("input_tokens", input_tokens)
        output_tokens = usage.get("output_tokens", output_tokens)
        total_tokens = usage.get("total_tokens", total_tokens)
    input_tokens = int(input_tokens or 0)
    output_tokens = int(output_tokens or 0)
    total_tokens = int(total_tokens or (input_tokens + output_tokens))
    return {"input": input_tokens, "output": output_tokens, "total": total_tokens}

AI_SERVICE_TIMEOUT_SECONDS = float(os.getenv("AI_SERVICE_TIMEOUT_SECONDS", "120"))
MAX_QR_SCAN_SECONDS = float(os.getenv("MAX_QR_SCAN_SECONDS", "8"))
MAX_QR_SCAN_PAGES = int(os.getenv("MAX_QR_SCAN_PAGES", "2"))
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "2"))


def _extract_vendor_nif_from_text(text: str) -> str | None:
    compact = re.sub(r"(?<=\w)\s+(?=\w)", "", text or "")
    patterns = [
        r"NIPC\s*[:\-]?\s*(?:PT)?\s*(\d{9})",
        r"NIF\s*(?:do\s+fornecedor|emitente)?\s*[:\-]?\s*(?:PT)?\s*(\d{9})",
    ]
    for pattern in patterns:
        match = re.search(pattern, compact, re.I)
        if match:
            return match.group(1)
    return None




class InvalidDocumentError(Exception):
    """Raised when an uploaded document cannot be read or parsed safely."""


def _collapse_broken_words(value: Any) -> str | None:
    if value in (None, ""):
        return value
    if isinstance(value, dict):
        parts = [f"{key}: {item}" for key, item in value.items() if item not in (None, "")]
        value = ", ".join(parts) if parts else None
    elif isinstance(value, list):
        parts = [str(item) for item in value if item not in (None, "")]
        value = ", ".join(parts) if parts else None
    elif not isinstance(value, str):
        value = str(value)
    if not value:
        return value
    tokens = value.split()
    new_tokens: list[str] = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if len(token) == 1 and token.isalpha():
            j = i
            buffer: list[str] = []
            while j < len(tokens) and len(tokens[j]) == 1 and tokens[j].isalpha():
                buffer.append(tokens[j])
                j += 1
            next_token = tokens[j] if j < len(tokens) else None
            if len(buffer) == 1 and next_token and next_token.isalpha() and next_token.islower() and buffer[0].isupper():
                new_tokens.append(buffer[0] + next_token)
                i = j + 1
                continue
            if len(buffer) > 1:
                new_tokens.append("".join(buffer))
                i = j
                continue
            new_tokens.extend(buffer)
            i = j
            continue
        new_tokens.append(token)
        i += 1
    return " ".join(new_tokens)

CATEGORY_KEYWORDS = {
    "contabilidade": "servicos",
    "consultoria": "servicos",
    "software": "servicos",
    "combustivel": "combustivel",
    "gasoleo": "combustivel",
    "gasolina": "combustivel",
    "supermercado": "alimentacao",
    "restaurante": "alimentacao",
    "papelaria": "material_escritorio",
    "escritorio": "material_escritorio",
    "transporte": "transporte",
}


CAPS_BLOCK_PATTERN = re.compile(r"(?:[A-Za-zÀ-ÖØ-öø-ÿ]\s){2,}[A-Za-zÀ-ÖØ-öø-ÿ]")


def _collapse_spaced_caps(value: str) -> str:
    def repl(match: re.Match) -> str:
        return match.group(0).replace(" ", "")

    return CAPS_BLOCK_PATTERN.sub(repl, value)


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _looks_like_scanned_pdf(text: str) -> bool:
    cleaned = _clean_text(text)
    if not cleaned:
        return True
    alnum_count = sum(char.isalnum() for char in cleaned)
    return len(cleaned) < 80 or alnum_count < 40


def _has_invoice_markers(text: str) -> bool:
    normalized = _collapse_spaced_caps(_clean_text(text)).lower()
    markers = [
        "fatura",
        "factura",
        "invoice",
        "nif",
        "iva",
        "total",
        "data de emiss",
        "data limite",
    ]
    return any(marker in normalized for marker in markers)


def _should_attempt_qr_scan(text: str) -> bool:
    normalized = _clean_text(text).lower()
    if len(normalized) < 120:
        return True
    markers = [
        "atcud",
        "fatura",
        "factura",
        "iva",
        "saft",
        "codigo qr",
        "código qr",
        "a:",
        "*a:",
    ]
    return any(marker in normalized for marker in markers)


VOWELS = set("aeiouáéíóúâêôàãõü")

def _looks_like_garbled_text(text: str) -> bool:
    tokens = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]{3,}", text)
    if not tokens:
        return False
    garbled = 0
    for token in tokens:
        normalized = token.lower()
        if not any(ch in VOWELS for ch in normalized):
            garbled += 1
    return (garbled / len(tokens)) > 0.35



def _normalize_tax_id(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D+", "", value)
    if len(digits) == 9:
        return digits
    return None


def _looks_like_placeholder_vendor_name(value: str | None) -> bool:
    if not value:
        return False
    cleaned = re.sub(r"\s+", " ", str(value)).strip().lower()
    if not cleaned:
        return False
    filename_markers = {
        "whatsapp image",
        "image",
        "img",
        "scan",
        "scanned",
        "screenshot",
        "document",
        "documento",
        "invoice",
        "fatura",
        "factura",
    }
    if any(marker in cleaned for marker in filename_markers):
        return True
    if re.search(r"\d{4}[-_/]\d{2}[-_/]\d{2}", cleaned):
        return True
    if re.search(r"\d{2}[.:]\d{2}(?:[.:]\d{2})?", cleaned):
        return True
    if sum(ch.isdigit() for ch in cleaned) >= 4 and sum(ch.isalpha() for ch in cleaned) <= 3:
        return True
    return False


def _tenant_id_from_context_headers(context_headers: dict[str, str] | None) -> str | None:
    if not context_headers:
        return None
    for key in ("x-viao-tenant-id", "X-Viao-Tenant-Id", "x-tenant-id", "X-Tenant-Id"):
        value = context_headers.get(key)
        if value:
            return str(value).strip() or None
    lowered = {str(key).lower(): value for key, value in context_headers.items()}
    for key in ("x-viao-tenant-id", "x-tenant-id"):
        value = lowered.get(key)
        if value:
            return str(value).strip() or None
    return None


def _lookup_learned_vendor_profile_from_nif(nif: str | None, tenant_id: str | None) -> dict[str, Any]:
    nif = _normalize_tax_id(nif)
    tenant_id = str(tenant_id or "").strip() or None
    if not nif or not tenant_id:
        return {}

    session = SessionLocal()
    try:
        profile = (
            session.query(VendorProfile)
            .filter(
                VendorProfile.tenant_id == tenant_id,
                VendorProfile.supplier_nif == nif,
            )
            .one_or_none()
        )
        if not profile:
            return {}
        try:
            payload = json.loads(profile.payload) if profile.payload else {}
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        vendor_name = profile.vendor_name or payload.get("vendor") or payload.get("name") or None
        if _looks_like_placeholder_vendor_name(vendor_name):
            return {}
        contact = payload.get("vendor_contact") or payload.get("contact")
        if not contact and isinstance(payload.get("contacts"), dict):
            contacts = payload.get("contacts") or {}
            parts = []
            for label, key in (("email", "email"), ("phone", "phone"), ("website", "website"), ("fax", "fax")):
                value = contacts.get(key)
                if value not in (None, ""):
                    parts.append(f"{label}: {value}")
            contact = ", ".join(parts) if parts else None
        return {
            "name": vendor_name,
            "address": payload.get("vendor_address") or payload.get("address") or None,
            "contact": contact,
            "raw": payload,
            "source": "learned",
        }
    finally:
        session.close()


def _resolve_vendor_profile_from_nif(
    nif: str | None,
    tenant_id: str | None = None,
    *,
    allow_external: bool = False,
) -> dict[str, Any]:
    learned = _lookup_learned_vendor_profile_from_nif(nif, tenant_id)
    if learned and any(learned.get(field) for field in ("name", "address", "contact")):
        return learned
    if allow_external:
        return _lookup_vendor_profile_from_nif(nif or "")
    return {}


def _format_vendor_contact_info(record: dict[str, Any]) -> str | None:
    contacts = record.get("contacts") if isinstance(record.get("contacts"), dict) else {}
    parts: list[str] = []
    for label, key in (("email", "email"), ("phone", "phone"), ("website", "website"), ("fax", "fax")):
        value = contacts.get(key) or record.get(key)
        if value not in (None, ""):
            parts.append(f"{label}: {value}")
    return ", ".join(parts) if parts else None


def _looks_like_placeholder_vendor_profile(record: dict[str, Any]) -> bool:
    name_blob = " ".join(str(record.get(key) or "") for key in ("title", "alias", "seo_url"))
    message_blob = " ".join(str(record.get(key) or "") for key in ("title", "alias", "message"))
    lowered = f"{name_blob} {message_blob}".lower()
    return "key necessary" in lowered or "contact www.nif.pt/contactos/api" in lowered or "contactos/api" in lowered



def _lookup_vendor_profile_from_nif(nif: str) -> dict[str, Any]:
    key = settings.nif_lookup_key or os.getenv("NIF_PT_API_KEY", "")
    if not nif or not key:
        return {}
    try:
        response = requests.get("https://www.nif.pt/?json=1", params={"q": nif, "key": key}, timeout=5)
        data = response.json()
    except Exception:
        return {}
    if data.get("result") != "success":
        return {}
    records = data.get("records") or {}
    for record in records.values():
        if _looks_like_placeholder_vendor_profile(record):
            continue
        title = (record.get("title") or record.get("alias") or "").strip() or None
        address = (
            record.get("address")
            or record.get("morada")
            or record.get("address_complete")
            or (record.get("place") or {}).get("address")
            or None
        )
        place = record.get("place") if isinstance(record.get("place"), dict) else {}
        zip_code = record.get("zip") or record.get("cod_postal") or None
        city = record.get("city") or record.get("localidade") or place.get("city") or None
        if zip_code and city and not address:
            address = f"{zip_code} {city}"
        elif zip_code and city and address and city not in str(address):
            address = f"{address}, {zip_code} {city}"
        elif city and address and city not in str(address):
            address = f"{address}, {city}"
        contact = _format_vendor_contact_info(record)
        if title or address or contact:
            return {
                "name": title,
                "address": str(address).strip() if address else None,
                "contact": contact,
                "contacts": record.get("contacts") if isinstance(record.get("contacts"), dict) else None,
                "raw": record,
            }
    return {}


def _lookup_vendor_name_from_nif(nif: str | None) -> str | None:
    if not nif:
        return None
    profile = _lookup_vendor_profile_from_nif(nif)
    return profile.get("name")


def _guess_vendor_name_from_text(text: str | None) -> str | None:
    if not text:
        return None
    noise = {
        "invoice",
        "fatura",
        "factura",
        "total",
        "nif",
        "atcud",
        "data",
        "date",
        "customer",
        "cliente",
        "fornecedor",
        "line",
        "item",
        "items",
    }
    candidates = [line.strip() for line in re.split(r"[\r\n]+", text) if line.strip()]
    for line in candidates[:12]:
        normalized = re.sub(r"\s+", " ", line).strip()
        lowered = normalized.lower()
        if len(normalized) < 3 or len(normalized) > 80:
            continue
        if any(token in lowered for token in noise):
            continue
        letters = sum(ch.isalpha() for ch in normalized)
        if letters < 3:
            continue
        digits = sum(ch.isdigit() for ch in normalized)
        if digits > letters:
            continue
        return normalized
    return None


def _build_qr_first_extraction(
    qr_data: dict[str, Any],
    text: str,
    file_name: str,
    vendor_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    supplier_nif = _normalize_tax_id(qr_data.get("supplier_nif"))
    vendor_profile = vendor_profile or {}
    vendor_name = vendor_profile.get("name") or _guess_vendor_name_from_text(text)
    vendor_address = vendor_profile.get("address")
    vendor_contact = vendor_profile.get("contact")

    total = _to_decimal(qr_data.get("total"))
    tax = _to_decimal(qr_data.get("tax"))
    subtotal = None
    if total is not None and tax is not None:
        try:
            subtotal = (total - tax).quantize(Decimal("0.01"))
        except Exception:
            subtotal = None

    notes = "Dados base extraídos do QR fiscal"
    if qr_data.get("hash_fragment"):
        notes += f" | Hash: {qr_data.get('hash_fragment')}"

    return {
        "vendor": vendor_name,
        "vendor_address": vendor_address,
        "vendor_contact": vendor_contact,
        "category": guess_category(f"{vendor_name} {text}"),
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "supplier_nif": supplier_nif,
        "customer_name": None,
        "customer_nif": _normalize_tax_id(qr_data.get("customer_nif")),
        "invoice_number": qr_data.get("invoice_number"),
        "invoice_date": qr_data.get("invoice_date"),
        "due_date": None,
        "currency": "EUR",
        "raw_text": text,
        "ai_payload": json.dumps({"source": "qr_fallback", "qr_data": qr_data}, ensure_ascii=False, default=str),
        "extraction_model": settings.extraction_model,
        "notes": notes,
        "line_items": _extract_qr_line_items(qr_data),
    }


def _looks_like_qr_line_item_text(value: str) -> bool:
    text = re.sub(r"\s+", " ", re.sub(r"[^\wÀ-ÿ0-9]+", " ", value, flags=re.UNICODE)).strip().lower()
    if not text:
        return False
    if len(text) < 3:
        return False
    digits_only = re.sub(r"\D+", "", text)
    letters = sum(ch.isalpha() for ch in text)
    if not letters:
        return False
    if digits_only and len(digits_only) == len(text):
        return False
    metadata_tokens = {
        "invoice",
        "fatura",
        "factura",
        "nif",
        "atcud",
        "hash",
        "total",
        "tax",
        "iva",
        "customer",
        "cliente",
        "supplier",
        "fornecedor",
        "document",
        "documento",
        "total",
        "subtotal",
        "amount",
        "valor",
        "price",
        "preco",
        "preço",
        "qty",
        "qtd",
        "quantity",
        "tax",
        "iva",
        "date",
        "data",
    }
    return not any(token in text for token in metadata_tokens)


def _sanitize_qr_line_item_description(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    if re.fullmatch(r"[\d\s.,€/-]+", cleaned):
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
        return None
    if re.fullmatch(r"\d{9}", cleaned):
        return None
    lowered = cleaned.lower()
    if any(token in lowered for token in {"fatura", "factura", "invoice", "nif", "atcud", "hash", "total", "subtotal", "tax", "iva", "customer", "cliente", "supplier", "fornecedor", "document", "documento"}):
        return None
    if sum(ch.isalpha() for ch in cleaned) < 3:
        return None
    return cleaned


def _extract_qr_line_items(qr_data: dict[str, Any]) -> list[dict[str, Any]]:
    explicit = qr_data.get("line_items")
    if isinstance(explicit, list):
        normalized: list[dict[str, Any]] = []
        for idx, item in enumerate(explicit):
            if isinstance(item, dict):
                description = _sanitize_qr_line_item_description(
                    item.get("description") or item.get("name") or item.get("text") or item.get("label")
                )
                code = item.get("code") if isinstance(item.get("code"), str) else None
                if not description and not code and not any(item.get(key) is not None for key in ("quantity", "unit_price", "subtotal", "line_subtotal", "tax_amount", "line_tax_amount", "total", "line_total", "tax_rate")):
                    continue
                normalized.append(
                    {
                        "position": idx + 1,
                        "code": code,
                        "description": description,
                        "quantity": item.get("quantity"),
                        "unit_price": item.get("unit_price"),
                        "line_subtotal": item.get("subtotal") or item.get("line_subtotal"),
                        "line_tax_amount": item.get("tax_amount") or item.get("line_tax_amount"),
                        "line_total": item.get("total") or item.get("line_total"),
                        "tax_rate": item.get("tax_rate"),
                    }
                )
        if normalized:
            return normalized

    candidates: list[str] = []
    qr_notes = qr_data.get("qr_notes")
    if isinstance(qr_notes, str):
        candidates.append(qr_notes)
    elif isinstance(qr_notes, list):
        candidates.extend(str(item) for item in qr_notes if item)

    extra_fields = qr_data.get("extra_fields")
    if isinstance(extra_fields, dict):
        for key, value in extra_fields.items():
            if key in {"A", "B", "C", "D", "E", "F", "G", "H", "L", "M", "N", "O", "P", "Q", "R", "S"}:
                continue
            if isinstance(value, str) and _looks_like_qr_line_item_text(value):
                candidates.append(value)

    line_items: list[dict[str, Any]] = []
    for raw_candidate in candidates:
        parts = [part.strip() for part in re.split(r"[\n|;]+", raw_candidate) if part.strip()]
        for part in parts:
            if not _looks_like_qr_line_item_text(part):
                continue
            description = _sanitize_qr_line_item_description(part)
            if not description:
                continue
            line_items.append(
                {
                    "position": len(line_items) + 1,
                    "code": None,
                    "description": description,
                    "quantity": None,
                    "unit_price": None,
                    "subtotal": None,
                    "tax_amount": None,
                    "total": None,
                    "tax_rate": None,
                }
            )
    return line_items


def _decode_qr_from_pil(image: Image.Image) -> str | None:
    try:
        rgb = image.convert("RGB")
    except Exception:
        return None

    variants = [rgb]
    for angle in (90, 180, 270):
        try:
            variants.append(rgb.rotate(angle, expand=True))
        except Exception:
            continue

    augmented: list[Image.Image] = []
    for variant in variants:
        augmented.append(variant)
        try:
            inverted = ImageOps.invert(variant)
            augmented.append(inverted)
        except Exception:
            pass
    for variant in augmented:
        decoded = zbar_decode(variant)
        for symbol in decoded:
            data = symbol.data.decode("utf-8", "ignore")
            if data:
                return data
        try:
            dm_decoded = dmtx_decode(variant)
        except Exception:
            dm_decoded = []
        for symbol in dm_decoded:
            data = symbol.data.decode("utf-8", "ignore")
            if data:
                return data

        if os.getenv("ENABLE_OPENCV_QR", "0").strip().lower() not in {"1", "true", "yes", "on"}:
            continue

        if zxingcpp is not None and os.getenv("ENABLE_ZXINGCPP_IMAGE", "0").strip().lower() in {"1", "true", "yes", "on"}:
            try:
                zx_results = zxingcpp.read_barcodes(variant, try_rotate=True, try_downscale=True, try_invert=True)
                for barcode in zx_results or []:
                    text = getattr(barcode, "text", None)
                    if text:
                        return text
            except Exception:
                pass

        try:
            arr = np.array(variant)
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        except Exception:
            continue

        bgr_variants = [bgr]
        for scale in (1.5, 2.0, 3.0, 4.0):
            try:
                bgr_variants.append(cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC))
            except Exception:
                pass

        for candidate_img in bgr_variants:
            value, _, _ = _qr_detector.detectAndDecode(candidate_img)
            if value:
                return value
            try:
                retval, decoded_values, _, _ = _qr_detector.detectAndDecodeMulti(candidate_img)
                if retval and isinstance(decoded_values, (list, tuple)):
                    for candidate in decoded_values:
                        if candidate:
                            return candidate
            except Exception:
                pass

            try:
                gray = cv2.cvtColor(candidate_img, cv2.COLOR_BGR2GRAY)
                _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                value, _, _ = _qr_detector.detectAndDecode(binary)
                if value:
                    return value
            except Exception:
                pass
    return None


def _extract_qr_payload_from_pdf(raw: bytes) -> str | None:
    started_at = time.monotonic()
    try:
        with fitz.open(stream=raw, filetype="pdf") as document:
            for page_index in range(min(MAX_QR_SCAN_PAGES, len(document))):
                if time.monotonic() - started_at > MAX_QR_SCAN_SECONDS:
                    logger.info("QR scan timeout after %.2fs on page %s", time.monotonic() - started_at, page_index)
                    return None
                page = document.load_page(page_index)

                # Render-first scan is more robust on malformed PDFs where get_images can be slow/noisy.
                for zoom in (2, 3, 4):
                    if time.monotonic() - started_at > MAX_QR_SCAN_SECONDS:
                        logger.info("QR render scan timeout after %.2fs", time.monotonic() - started_at)
                        return None
                    try:
                        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
                    except Exception:
                        continue
                    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    payload = _decode_qr_from_pil(image)
                    if payload:
                        return payload
                    width, height = image.size
                    crops = [
                        (0, 0, width // 2, height // 2),
                        (width // 2, 0, width, height // 2),
                        (0, height // 2, width // 2, height),
                        (width // 2, height // 2, width, height),
                        (width // 4, height // 4, (width * 3) // 4, (height * 3) // 4),
                        ((width * 2) // 3, 0, width, height // 3),
                        ((width * 3) // 5, 0, width, height // 2),
                        ((width * 2) // 3, height // 12, width, (height * 5) // 12),
                    ]
                    for box in crops:
                        if time.monotonic() - started_at > MAX_QR_SCAN_SECONDS:
                            logger.info("QR crop scan timeout after %.2fs", time.monotonic() - started_at)
                            return None
                        left, top, right, bottom = box
                        if right - left < 80 or bottom - top < 80:
                            continue
                        cropped = image.crop(box)
                        payload = _decode_qr_from_pil(cropped)
                        if payload:
                            return payload

                for image_info in page.get_images(full=True):
                    if time.monotonic() - started_at > MAX_QR_SCAN_SECONDS:
                        logger.info("QR image scan timeout after %.2fs", time.monotonic() - started_at)
                        return None
                    xref = image_info[0]
                    try:
                        extracted = document.extract_image(xref)
                    except Exception:
                        continue
                    stream = extracted.get("image")
                    if not stream:
                        continue
                    try:
                        pil_image = Image.open(io.BytesIO(stream))
                    except Exception:
                        continue
                    payload = _decode_qr_from_pil(pil_image)
                    if payload:
                        return payload
    except Exception:
        return None
    return None


def parse_portuguese_qr_payload(payload: str | None) -> dict[str, Any]:
    if not payload:
        return {}

    normalized_payload = payload.replace("\r", "\n")
    token_matches = list(re.finditer(r"([A-Z][0-9]?):", normalized_payload))
    ordered_fields: "OrderedDict[str, str]" = OrderedDict()
    for index, match in enumerate(token_matches):
        code = match.group(1)
        start = match.end()
        end = token_matches[index + 1].start() if index + 1 < len(token_matches) else len(normalized_payload)
        value = normalized_payload[start:end].strip().strip("*;")
        ordered_fields[code] = value

    if not ordered_fields:
        return {}

    fields = ordered_fields
    result: dict[str, Any] = {"qr_payload": payload, "qr_fields": list(ordered_fields.items())}

    result["supplier_nif"] = fields.get("A") or None
    result["customer_nif"] = fields.get("B") or None
    result["customer_country"] = fields.get("C") or None
    result["document_type"] = fields.get("D") or None
    result["document_status"] = fields.get("E") or None
    raw_date = fields.get("F")
    if raw_date and len(raw_date) == 8 and raw_date.isdigit():
        result["invoice_date"] = f"{raw_date[0:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
    result["invoice_number"] = fields.get("G") or None
    result["atcud"] = fields.get("H") or None

    def _qr_decimal(value: str | None) -> Decimal | None:
        if not value:
            return None
        try:
            return Decimal(value.replace(" ", "").replace(",", "."))
        except (InvalidOperation, ValueError):
            return None

    result["tax"] = _qr_decimal(fields.get("N"))
    result["total"] = _qr_decimal(fields.get("O"))
    result["non_taxable"] = _qr_decimal(fields.get("L"))
    result["stamp_duty"] = _qr_decimal(fields.get("M"))
    result["withholding_tax"] = _qr_decimal(fields.get("P"))

    result["hash_fragment"] = fields.get("Q") or None
    result["software_certificate"] = fields.get("R") or None

    other_info = fields.get("S")
    if other_info:
        parts = [part.strip() for part in other_info.split(";") if part.strip()]
        result["qr_notes"] = parts if parts else [other_info]

    regions: list[dict[str, Any]] = []
    for prefix in ("I", "J", "K"):
        keys = [f"{prefix}{i}" for i in range(1, 9)]
        if not any(key in fields for key in keys):
            continue
        region = {
            "region": fields.get(f"{prefix}1") or None,
            "exempt_base": _qr_decimal(fields.get(f"{prefix}2")),
            "reduced_base": _qr_decimal(fields.get(f"{prefix}3")),
            "reduced_tax": _qr_decimal(fields.get(f"{prefix}4")),
            "intermediate_base": _qr_decimal(fields.get(f"{prefix}5")),
            "intermediate_tax": _qr_decimal(fields.get(f"{prefix}6")),
            "standard_base": _qr_decimal(fields.get(f"{prefix}7")),
            "standard_tax": _qr_decimal(fields.get(f"{prefix}8")),
        }
        regions.append(region)
    if regions:
        result["tax_regions"] = regions

    core_fields = {"A", "B", "C", "D", "E", "F", "G", "H", "L", "M", "N", "O", "P", "Q", "R", "S"}
    extra_fields = {code: value for code, value in fields.items() if code not in core_fields and value}
    if extra_fields:
        result["extra_fields"] = extra_fields

    return result

def _ocr_text_from_image(image: Image.Image) -> str:
    if pytesseract is None:
        return ""

    try:
        normalized = ImageOps.exif_transpose(image).convert("L")
    except Exception:
        try:
            normalized = image.convert("L")
        except Exception:
            return ""

    try:
        return (pytesseract.image_to_string(normalized, lang=settings.ocr_languages) or "").strip()
    except Exception:
        try:
            return (pytesseract.image_to_string(normalized) or "").strip()
        except Exception:
            return ""


def _extract_text_from_image_bytes_with_local_ocr(raw: bytes) -> str:
    try:
        image = Image.open(io.BytesIO(raw))
    except Exception:
        return ""
    return _ocr_text_from_image(image)


def _extract_qr_payload_from_image(raw: bytes) -> str | None:
    started_at = time.monotonic()

    def timed_out() -> bool:
        return (time.monotonic() - started_at) > MAX_QR_SCAN_SECONDS

    try:
        image = Image.open(io.BytesIO(raw))
    except Exception:
        return None

    try:
        width, height = image.size
    except Exception:
        return _decode_qr_from_pil(image)

    # Bottom-heavy scans first, since Portuguese invoice QR codes are commonly
    # printed near the footer and can be missed by full-frame reads on photos.
    payload = _decode_qr_from_pil(image)
    if payload:
        return payload

    bottom_regions = [
        (0, (height * 55) // 100, width, height),
        (0, (height * 60) // 100, width, height),
        (0, (height * 65) // 100, width, height),
        (0, (height * 45) // 100, width, height),
        (0, (height * 50) // 100, width, height),
        (0, (height * 70) // 100, width, height),
        (0, (height * 60) // 100, (width * 60) // 100, height),
        ((width * 40) // 100, (height * 60) // 100, width, height),
        (0, (height * 60) // 100, (width * 50) // 100, height),
        ((width * 50) // 100, (height * 60) // 100, width, height),
        ((width * 30) // 100, (height * 60) // 100, (width * 70) // 100, height),
    ]
    for box in bottom_regions:
        if timed_out():
            logger.info("QR image scan timeout after %.2fs", time.monotonic() - started_at)
            return None
        left, top, right, bottom = box
        if right - left < 80 or bottom - top < 80:
            continue
        try:
            payload = _decode_qr_from_pil(image.crop(box))
        except Exception:
            payload = None
        if payload:
            return payload

    try:
        width, height = image.size
    except Exception:
        return None

    crops = [
        (0, 0, width // 2, height // 2),
        (width // 2, 0, width, height // 2),
        (0, height // 2, width // 2, height),
        (width // 2, height // 2, width, height),
        (width // 4, height // 4, (width * 3) // 4, (height * 3) // 4),
        ((width * 2) // 3, 0, width, height // 3),
        ((width * 3) // 5, 0, width, height // 2),
        ((width * 2) // 3, height // 12, width, (height * 5) // 12),
    ]
    for box in crops:
        if timed_out():
            logger.info("QR image scan timeout after %.2fs", time.monotonic() - started_at)
            return None
        left, top, right, bottom = box
        if right - left < 80 or bottom - top < 80:
            continue
        try:
            payload = _decode_qr_from_pil(image.crop(box))
        except Exception:
            payload = None
        if payload:
            return payload
    return None


def _extract_text_from_image_with_vision(
    raw: bytes,
    file_name: str,
    context_headers: dict[str, str] | None = None,
) -> tuple[str, dict[str, int]]:
    mime_type = mimetypes.guess_type(file_name)[0] or "image/jpeg"
    data_url = f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}"
    prompt = (
        "Read this invoice photo and extract all visible text faithfully. "
        "Return plain text only, no JSON, no markdown, no commentary. "
        "Preserve numbers, dates, tax IDs, totals, and line-item rows."
    )
    content, usage = ai_chat_completion(
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        model=settings.vision_model,
        max_tokens=1200,
        temperature=0.0,
        timeout_seconds=AI_SERVICE_TIMEOUT_SECONDS,
        context_headers=context_headers,
    )
    return (content or "").strip(), usage


def _extract_text_from_pdf_with_local_ocr(raw: bytes, file_name: str) -> str:
    if pytesseract is None:
        logger.warning("Local OCR unavailable for %s, pytesseract is missing", file_name)
        return ""

    pages: list[str] = []
    try:
        with fitz.open(stream=raw, filetype="pdf") as document:
            for page_index in range(min(MAX_OCR_PAGES, len(document))):
                page = document.load_page(page_index)
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                text = _ocr_text_from_image(image)
                if text:
                    pages.append(text)
    except Exception as exc:
        logger.warning("Local OCR failed for %s: %s", file_name, exc)
        return ""
    return _clean_text("\n".join(pages))


def extract_text_from_upload(upload) -> tuple[str, bytes, dict[str, int]]:
    filename = (upload.filename or "documento").lower()
    raw = upload.file.read()
    upload.file.seek(0)
    usage = _usage_dict()
    text = ""

    if filename.endswith(".pdf"):
        try:
            reader = PdfReader(upload.file)
            pages = [page.extract_text() or "" for page in reader.pages]
            upload.file.seek(0)
            text = "\n".join(pages)
        except Exception:
            upload.file.seek(0)
            try:
                with fitz.open(stream=raw, filetype="pdf") as document:
                    text = "\n".join(page.get_text() or "" for page in document)
            except Exception as exc:
                raise InvalidDocumentError("PDF inválido ou corrompido") from exc
            finally:
                upload.file.seek(0)
        should_use_pdf_ocr = (
            _looks_like_scanned_pdf(text)
            or _looks_like_garbled_text(text)
            or not _has_invoice_markers(text)
        )
        if should_use_pdf_ocr:
            try:
                logger.info("Running local PDF OCR fallback for %s", upload.filename or "documento")
                ocr_text = _extract_text_from_pdf_with_local_ocr(raw, upload.filename or "documento")
                text = ocr_text or text
            except Exception as exc:
                logger.warning("PDF OCR fallback failed for %s: %s", upload.filename or "documento", exc)
    elif any(filename.endswith(ext) for ext in _IMAGE_EXTENSIONS):
        ocr_text = _extract_text_from_image_bytes_with_local_ocr(raw)
        if ocr_text:
            text = ocr_text
    else:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="ignore")

    text = text.replace("\x00", " ")
    text = _collapse_spaced_caps(text)
    return _clean_text(text), raw, usage


def guess_category(text: str) -> str:
    lowered = text.lower()
    for keyword, category in CATEGORY_KEYWORDS.items():
        if keyword in lowered:
            return category
    return "servicos"


def _to_decimal(value: Any, quant: str = "0.01") -> Decimal | None:
    if value in (None, ""):
        return None
    limit = Decimal("10000000000")
    quant_value = Decimal(quant)
    if isinstance(value, Decimal):
        candidate = value.quantize(quant_value)
    elif isinstance(value, (int, float, str)):
        try:
            normalized = str(value).replace("€", "").replace(" ", "").replace(",", ".")
            candidate = Decimal(normalized).quantize(quant_value)
        except (InvalidOperation, ValueError):
            return None
    else:
        return None

    if candidate >= limit or candidate <= -limit:
        return None
    return candidate


def _normalize_line_items(line_items: Any, fallback_description: str | None, subtotal: Decimal | None) -> List[dict[str, Any]]:
    normalized: List[dict[str, Any]] = []
    fallback_clean = _sanitize_qr_line_item_description(fallback_description) if fallback_description else None
    if isinstance(line_items, list):
        for idx, item in enumerate(line_items):
            if not isinstance(item, dict):
                continue
            description = _sanitize_qr_line_item_description(item.get("description") or item.get("name") or item.get("text") or item.get("label"))
            code = item.get("code") if isinstance(item.get("code"), str) else None
            normalized.append(
                {
                    "position": idx + 1,
                    "code": code.strip() if code else None,
                    "description": description or fallback_clean,
                    "quantity": _to_decimal(item.get("quantity")),
                    "unit_price": _to_decimal(item.get("unit_price")),
                    "line_subtotal": _to_decimal(item.get("subtotal")) or _to_decimal(item.get("line_subtotal")),
                    "line_tax_amount": _to_decimal(item.get("tax_amount")) or _to_decimal(item.get("line_tax_amount")),
                    "line_total": _to_decimal(item.get("total")) or _to_decimal(item.get("line_total")),
                    "tax_rate": _to_decimal(item.get("tax_rate"), quant="0.01"),
                }
            )

    if not normalized and fallback_clean:
        normalized.append(
            {
                "position": 1,
                "code": None,
                "description": fallback_clean,
                "quantity": Decimal("1.00") if subtotal else None,
                "unit_price": subtotal,
                "line_subtotal": subtotal,
                "line_tax_amount": None,
                "line_total": subtotal,
                "tax_rate": None,
            }
        )
    return normalized


def _line_items_have_meaningful_content(line_items: Any) -> bool:
    if not isinstance(line_items, list) or not line_items:
        return False
    for item in line_items:
        if not isinstance(item, dict):
            continue
        description = _sanitize_qr_line_item_description(
            item.get("description") or item.get("name") or item.get("text") or item.get("label")
        )
        code = item.get("code") if isinstance(item.get("code"), str) else None
        if description or (code and code.strip()):
            return True
        if any(item.get(key) not in (None, "") for key in ("quantity", "unit_price", "subtotal", "line_subtotal", "tax_amount", "line_tax_amount", "total", "line_total", "tax_rate")):
            return True
    return False


def _select_line_item_source(qr_line_items: Any, ai_line_items: Any) -> Any:
    if _line_items_have_meaningful_content(ai_line_items):
        return ai_line_items
    if _line_items_have_meaningful_content(qr_line_items):
        return qr_line_items
    if isinstance(ai_line_items, list):
        return ai_line_items
    if isinstance(qr_line_items, list):
        return qr_line_items
    return []


def _normalize_for_search(value: str | None) -> str:
    if not value:
        return ""
    collapsed = _collapse_spaced_caps(value)
    return re.sub(r"\s+", " ", collapsed).lower().strip()


def _maybe_correct_parties(
    vendor: str,
    customer: str | None,
    supplier_nif: str | None,
    customer_nif: str | None,
    text: str,
    correction_message: str | None = None,
) -> tuple[str, str | None, str | None, str | None]:
    return vendor, customer, supplier_nif, customer_nif


def _extract_with_ai_service(
    text: str,
    file_name: str,
    correction_message: str | None = None,
    previous_payload: str | None = None,
    context_headers: dict[str, str] | None = None,
    qr_data: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, int]]:
    usage_total = _usage_dict()
    prompt = (
        f"{EXTRACTION_PROMPT_BASE}\n\n"
        f"filename: {Path(file_name).name}\n"
        f"text: {text[:12000]}"
    )
    if qr_data:
        prompt += (
            "\nQR payload (Portuguese invoice barcode):\n"
            + json.dumps(qr_data, ensure_ascii=False, default=str)
            + "\nUse the QR payload as the source of truth for supplier_nif, invoice_number, invoice_date, total, tax, and any embedded item text. "
            + "Do not use supplier/customer/header text as line-item descriptions unless the item table is clearly visible."
        )
    if correction_message:
        prompt += "\nCorrections requested: " + correction_message.strip() + "\n"
        if previous_payload:
            trimmed = previous_payload[:3500]
            prompt += "Previous JSON output:\n" + trimmed + "\n"
        prompt += CORRECTION_PROMPT_SUFFIX + "\n"

    content, usage = ai_chat_completion(
        messages=[{"role": "user", "content": prompt}],
        model=settings.extraction_model,
        max_tokens=550,
        temperature=0.0,
        timeout_seconds=AI_SERVICE_TIMEOUT_SECONDS,
        context_headers=context_headers,
    )
    _accumulate_usage(usage_total, usage)
    if not content:
        raise RuntimeError("Modelo não devolveu conteúdo")

    match = re.search(r"\{.*\}", content, re.S)
    payload = match.group(0) if match else content
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        repair_prompt = f"{JSON_REPAIR_PROMPT}\n\n{payload[:8000]}"
        repaired, repair_usage = ai_chat_completion(
            messages=[{"role": "user", "content": repair_prompt}],
            model=settings.extraction_model,
            max_tokens=700,
            temperature=0.0,
            timeout_seconds=AI_SERVICE_TIMEOUT_SECONDS,
            context_headers=context_headers,
        )
        _accumulate_usage(usage_total, repair_usage)
        repaired_match = re.search(r"\{.*\}", repaired, re.S)
        repaired_payload = repaired_match.group(0) if repaired_match else repaired
        try:
            data = json.loads(repaired_payload)
        except json.JSONDecodeError as exc:
            raise InvalidDocumentError("Resposta do modelo não pôde ser convertida em JSON válido") from exc
    data["notes"] = data.get("notes") or f"Documento processado por IA: {Path(file_name).name}"
    return data, usage_total


def _determine_document_type(text: str, extraction: dict[str, Any], qr_data: dict[str, Any]) -> tuple[bool, str, str]:
    lowered = (text or "").lower()

    type_keywords: list[tuple[str, list[str]]] = [
        ("payroll", ["recibo de vencimento", "recibo salarial", "processamento salarial", "salary receipt", "payroll"]),
        ("bank_statement", ["extrato bancario", "extrato bancário", "bank statement", "movimentos", "iban", "saldo disponível", "saldo contabilístico"]),
        ("purchase_order", ["nota de encomenda", "purchase order", "ordem de compra", "encomenda"]),
        ("delivery_note", ["guia de transporte", "delivery note", "guia remessa", "guia de remessa"]),
        ("quote", ["orçamento", "orcamento", "budget", "quotation", "quote", "proposta comercial"]),
        ("payment_certificate", ["certificacao de pagamento", "certificação de pagamento", "pagamento efetuado com sucesso", "pagamento em prestacoes", "pagamento em prestações", "pagamento prestacional", "processo de execucao fiscal", "processo de execução fiscal", "plano prestacional", "guia de pagamento", "certidao de pagamento", "certidão de pagamento", "documento unico de cobranca", "documento único de cobrança", "duc", "irs", "duc pagamento", "recibo de imposto"]),
        ("receipt", ["recibo", "receipt", "comprovativo"]),
        ("credit_note", ["nota de crédito", "nota de credito", "credit note"]),
        ("debit_note", ["nota de débito", "nota de debito", "debit note"]),
        ("invoice", ["fatura", "factura", "invoice", "fatura-recibo", "fatura recibo"]),
    ]

    qr_document_type = str(qr_data.get("document_type") or "").upper().strip()
    if qr_document_type.startswith(("FT", "FR", "FS")):
        return True, "invoice", f"QR document type {qr_document_type}"
    if qr_document_type.startswith("NC"):
        return True, "credit_note", f"QR document type {qr_document_type}"
    if qr_document_type.startswith("ND"):
        return True, "debit_note", f"QR document type {qr_document_type}"

    matched_types = [doc_type for doc_type, keywords in type_keywords if any(term in lowered for term in keywords)]

    evidence_score = 0
    if "invoice" in matched_types:
        evidence_score += 2
    if extraction.get("invoice_number"):
        evidence_score += 1
    if extraction.get("invoice_date"):
        evidence_score += 1
    if extraction.get("supplier_nif"):
        evidence_score += 1
    if extraction.get("total") is not None:
        evidence_score += 1
    if extraction.get("tax") is not None:
        evidence_score += 1
    if extraction.get("line_items"):
        evidence_score += 1

    invoice_like = any(doc_type in matched_types for doc_type in ["invoice", "credit_note", "debit_note"])
    non_invoice_types = ["payroll", "bank_statement", "purchase_order", "delivery_note", "quote", "payment_certificate"]
    if not invoice_like and any(doc_type in matched_types for doc_type in non_invoice_types):
        detected_type = next(doc_type for doc_type in matched_types if doc_type in non_invoice_types)
        return False, detected_type, f"Document identified as {detected_type.replace('_', ' ')}"

    if "receipt" in matched_types and evidence_score < 4:
        return False, "receipt", "Document looks like a receipt, not a full invoice"

    if invoice_like or evidence_score >= 4:
        detected_type = next((doc_type for doc_type in matched_types if doc_type in ["invoice", "credit_note", "debit_note"]), "invoice")
        return True, detected_type, f"Detected {detected_type.replace('_', ' ')} structure with score {evidence_score}"

    return False, "unknown", "Could not validate the document as an invoice or accepted fiscal document"


PRECHECK_BLOCKED_TYPES = {
    "payroll",
    "bank_statement",
    "purchase_order",
    "delivery_note",
    "quote",
    "payment_certificate",
}


def precheck_invoice_candidate(upload: UploadFile) -> tuple[bool, str, str, str, bytes, dict[str, int]]:
    text, raw, usage = extract_text_from_upload(upload)
    qr_payload = None
    filename = (upload.filename or "").lower()
    if raw and filename.endswith(tuple(_IMAGE_EXTENSIONS)):
        qr_payload = _extract_qr_payload_from_image(raw)
    elif raw and filename.endswith(".pdf") and _should_attempt_qr_scan(text):
        qr_payload = _extract_qr_payload_from_pdf(raw)
    qr_data = parse_portuguese_qr_payload(qr_payload)
    dummy_extraction = {
        "invoice_number": None,
        "invoice_date": None,
        "supplier_nif": None,
        "customer_nif": None,
        "subtotal": None,
        "tax": None,
        "total": None,
        "line_items": None,
    }
    is_invoice, detected_type, validation_reason = _determine_document_type(text=text, extraction=dummy_extraction, qr_data=qr_data)
    if qr_data and not is_invoice:
        qr_hint_extraction = {
            **dummy_extraction,
            "invoice_number": qr_data.get("invoice_number"),
            "invoice_date": qr_data.get("invoice_date"),
            "supplier_nif": _normalize_tax_id(qr_data.get("supplier_nif")),
            "total": _to_decimal(qr_data.get("total")),
            "tax": _to_decimal(qr_data.get("tax")),
            "line_items": qr_data.get("line_items"),
        }
        is_invoice, detected_type, validation_reason = _determine_document_type(text=text, extraction=qr_hint_extraction, qr_data=qr_data)
    should_process = is_invoice or detected_type not in PRECHECK_BLOCKED_TYPES
    reason = validation_reason if should_process else f"Pré-check: {validation_reason}"
    return should_process, detected_type, reason, text, raw, usage


def extract_invoice_data(
    upload: UploadFile,
    preextracted_text: str | None = None,
    preextracted_raw: bytes | None = None,
    preextracted_usage: dict[str, int] | None = None,
    context_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    context_headers = context_headers or _request_ai_headers()
    tenant_id = _tenant_id_from_context_headers(context_headers)
    file_label = upload.filename or "documento"
    filename = file_label.lower()
    is_image_upload = filename.endswith(tuple(_IMAGE_EXTENSIONS))
    text = preextracted_text
    raw = preextracted_raw
    usage_total = _usage_dict()
    _accumulate_usage(usage_total, preextracted_usage)
    if text is None or raw is None:
        text, raw, usage = extract_text_from_upload(upload)
        _accumulate_usage(usage_total, usage)

    qr_payload = None
    if filename.endswith(".pdf") and raw and _should_attempt_qr_scan(text):
        qr_payload = _extract_qr_payload_from_pdf(raw)
    elif is_image_upload and raw:
        qr_payload = _extract_qr_payload_from_image(raw)
    qr_data = parse_portuguese_qr_payload(qr_payload)
    qr_vendor_profile = _resolve_vendor_profile_from_nif(qr_data.get("supplier_nif"), tenant_id=tenant_id, allow_external=True) if qr_data else {}

    if raw and filename.endswith(tuple(_IMAGE_EXTENSIONS)) and (not text or _looks_like_garbled_text(text) or not _has_invoice_markers(text)):
        try:
            vision_text, vision_usage = _extract_text_from_image_with_vision(raw, file_label, context_headers=context_headers)
            _accumulate_usage(usage_total, vision_usage)
            if vision_text:
                text = vision_text if not text else f"{text}\n{vision_text}"
        except Exception as exc:
            logger.warning("Vision fallback failed for %s: %s", file_label, exc)

    if qr_data and (not text or _looks_like_garbled_text(text) or not _has_invoice_markers(text)):
        qr_hint_lines = ["QR payload detected in invoice image:"]
        for key in ("document_type", "supplier_nif", "customer_nif", "invoice_number", "invoice_date", "total", "tax", "atcud", "hash_fragment"):
            value = qr_data.get(key)
            if value not in (None, ""):
                qr_hint_lines.append(f"{key}: {value}")
        text = (text + "\n" if text else "") + "\n".join(qr_hint_lines)

    qr_primary_extraction: dict[str, Any] | None = None
    if is_image_upload and qr_data:
        qr_primary_extraction = _build_qr_first_extraction(qr_data=qr_data, text=text, file_name=file_label, vendor_profile=qr_vendor_profile)
        qr_primary_extraction["qr_data"] = qr_data
        qr_primary_extraction["qr_payload"] = qr_payload

    used_ai_extraction = False
    try:
        extraction = build_extraction_from_text(text=text, file_name=file_label, context_headers=context_headers, qr_data=qr_data)
        used_ai_extraction = True
    except Exception:
        if qr_primary_extraction is not None:
            extraction = qr_primary_extraction
        else:
            raise

    _accumulate_usage(
        usage_total,
        {
            "input": int(extraction.get("token_input") or 0),
            "output": int(extraction.get("token_output") or 0),
            "total": int(extraction.get("token_total") or 0),
        },
    )

    normalized_supplier = _normalize_tax_id(extraction.get("supplier_nif"))
    if not normalized_supplier:
        fallback_supplier = _extract_vendor_nif_from_text(text)
        if fallback_supplier:
            extraction["supplier_nif"] = fallback_supplier
    else:
        extraction["supplier_nif"] = normalized_supplier
    if used_ai_extraction and not _ai_returned_line_items(extraction):
        retry_extraction = build_extraction_from_text(
            text=text,
            file_name=file_label,
            correction_message="Line items missing. Extract every individual row from the product/service table, including code, description, quantity, unit_price, subtotal, tax amount and total.",
            previous_payload=extraction.get("ai_payload"),
            context_headers=context_headers,
            qr_data=qr_data,
        )
        if _ai_returned_line_items(retry_extraction):
            retry_extraction["token_input"] = int(retry_extraction.get("token_input") or 0) + int(extraction.get("token_input") or 0)
            retry_extraction["token_output"] = int(retry_extraction.get("token_output") or 0) + int(extraction.get("token_output") or 0)
            retry_extraction["token_total"] = int(retry_extraction.get("token_total") or 0) + int(extraction.get("token_total") or 0)
            extraction = retry_extraction
    if qr_data:
        extraction["qr_data"] = qr_data
        extraction["qr_payload"] = qr_payload
        if qr_primary_extraction and qr_primary_extraction.get("subtotal") is not None:
            extraction["subtotal"] = qr_primary_extraction["subtotal"]
        supplier_nif = _normalize_tax_id(qr_data.get("supplier_nif"))
        if supplier_nif:
            extraction["supplier_nif"] = supplier_nif
            vendor_profile = qr_vendor_profile or _resolve_vendor_profile_from_nif(supplier_nif, tenant_id=tenant_id, allow_external=True)
            vendor_name = vendor_profile.get("name")
            if vendor_name:
                extraction["vendor"] = vendor_name
            if vendor_profile.get("address") and not extraction.get("vendor_address"):
                extraction["vendor_address"] = vendor_profile["address"]
            if vendor_profile.get("contact") and not extraction.get("vendor_contact"):
                extraction["vendor_contact"] = vendor_profile["contact"]
        customer_nif = _normalize_tax_id(qr_data.get("customer_nif"))
        if customer_nif:
            extraction["customer_nif"] = customer_nif
        for field in ["invoice_number", "invoice_date", "tax", "total", "document_type", "customer_country", "hash_fragment", "software_certificate"]:
            value = qr_data.get(field)
            if value not in (None, ""):
                extraction[field] = value
        extraction["notes"] = (extraction.get("notes") or "") + " | QR português detetado"

    final_supplier = _normalize_tax_id(extraction.get("supplier_nif"))
    if final_supplier:
        extraction["supplier_nif"] = final_supplier
        vendor_profile = _lookup_vendor_profile_from_nif(final_supplier)
        vendor_name = vendor_profile.get("name")
        if vendor_name:
            extraction["vendor"] = vendor_name
        if vendor_profile.get("address") and not extraction.get("vendor_address"):
            extraction["vendor_address"] = vendor_profile["address"]
        if vendor_profile.get("contact") and not extraction.get("vendor_contact"):
            extraction["vendor_contact"] = vendor_profile["contact"]

    is_invoice, detected_type, validation_reason = _determine_document_type(text=text, extraction=extraction, qr_data=qr_data)
    extraction["is_invoice"] = is_invoice
    extraction["detected_type"] = detected_type
    extraction["validation_reason"] = validation_reason
    extraction["token_input"] = usage_total["input"]
    extraction["token_output"] = usage_total["output"]
    extraction["token_total"] = usage_total["total"]
    return extraction


def _is_swap_parties_correction(correction_message: str | None) -> bool:
    correction_norm = _normalize_for_search(correction_message)
    if not correction_norm:
        return False
    return (
        ("swap" in correction_norm or "troca" in correction_norm or "invert" in correction_norm or "ao contrario" in correction_norm or "ao contrário" in correction_norm)
        and ("vendor" in correction_norm or "fornecedor" in correction_norm)
        and ("client" in correction_norm or "cliente" in correction_norm or "customer" in correction_norm)
    )


def _extract_nif_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    for match in re.finditer(r"(?:PT\s*)?(\d{9})", text, re.I):
        value = match.group(1)
        if value not in candidates:
            candidates.append(value)
    return candidates


def _extract_due_date_from_text(text: str) -> str | None:
    patterns = [
        r"data\s+de\s+vencimento\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})",
        r"vencimento\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})",
        r"vencimento\s+em\s*[:\-]?\s*(\d{2}/\d{2}/\d{4})",
    ]
    lowered = text.lower()
    for pattern in patterns:
        match = re.search(pattern, lowered, re.I)
        if match:
            return match.group(1)
    return None


def _apply_deterministic_corrections(result: dict[str, Any], text: str, correction_message: str | None) -> dict[str, Any]:
    if not correction_message:
        return result

    message = correction_message.strip()
    lowered = message.lower()

    def mentions_invalid(field_aliases: list[str]) -> bool:
        return any(alias in lowered for alias in field_aliases) and any(
            token in lowered for token in ["incorrect", "incorreto", "errado", "invalid", "invalido", "inválido", "wrong"]
        )

    if _is_swap_parties_correction(correction_message):
        result["vendor"], result["customer_name"] = result.get("customer_name") or result.get("vendor"), result.get("vendor")
        result["supplier_nif"], result["customer_nif"] = result.get("customer_nif"), result.get("supplier_nif")

    vendor_match = re.search(r"(?:nome\s+do\s+)?fornecedor\s+(?:eh|é|e)\s+([^,\.]+)", message, re.I)
    if vendor_match:
        candidate = vendor_match.group(1).strip()
        if len(candidate.split()) <= 8:
            result["vendor"] = candidate

    customer_match = re.search(r"(?:nome\s+do\s+)?cliente\s+(?:eh|é|e)\s+([^,\.]+)", message, re.I)
    if customer_match:
        candidate = customer_match.group(1).strip()
        if len(candidate.split()) <= 8:
            result["customer_name"] = candidate

    if ("data de vencimento" in lowered or "vencimento" in lowered) and ("em branco" in lowered or "falta" in lowered):
        due_date = _extract_due_date_from_text(text)
        if due_date:
            result["due_date"] = due_date

    invalid_customer_markers = {
        "EXMO(S)",
        "EXMO (S)",
        "EXMO(S) SR (S)",
        "EXMO(S) SENHOR(ES)",
        "CLIENTE",
    }
    customer_name = str(result.get("customer_name") or "").strip().upper()
    if customer_name in invalid_customer_markers:
        result["customer_name"] = None

    if "nif do fornecedor" in lowered and ("falta" in lowered or "em falta" in lowered or "missing" in lowered):
        candidates = _extract_nif_candidates(text)
        current_customer_nif = re.sub(r"\D+", "", str(result.get("customer_nif") or "")) or None
        for candidate in candidates:
            if candidate != current_customer_nif:
                result["supplier_nif"] = candidate
                break

    if mentions_invalid(["nif fornecedor", "nif do fornecedor", "supplier nif", "supplier_nif"]):
        result["supplier_nif"] = None

    if mentions_invalid(["nif cliente", "nif do cliente", "customer nif", "customer_nif"]):
        result["customer_nif"] = None

    if mentions_invalid(["data vencimento", "data de vencimento", "due date", "due_date"]):
        result["due_date"] = None

    return result



def _ai_returned_line_items(extraction: dict[str, Any]) -> bool:
    payload = extraction.get("ai_payload")
    if not payload:
        return False
    try:
        ai_data = json.loads(payload)
    except json.JSONDecodeError:
        return False
    line_items = ai_data.get("line_items")
    return isinstance(line_items, list) and bool(line_items)



def build_extraction_from_text(
    text: str,
    file_name: str,
    *,
    correction_message: str | None = None,
    previous_payload: str | None = None,
    context_headers: dict[str, str] | None = None,
    qr_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ai_data, usage = _extract_with_ai_service(
        text=text,
        file_name=file_name,
        correction_message=correction_message,
        previous_payload=previous_payload,
        context_headers=context_headers,
        qr_data=qr_data,
    )
    vendor = ai_data.get("vendor") or _guess_vendor_name_from_text(text)
    vendor_address = ai_data.get("vendor_address")
    vendor_contact = ai_data.get("vendor_contact")
    customer_name = ai_data.get("customer_name")
    supplier_nif = ai_data.get("supplier_nif")
    customer_nif = ai_data.get("customer_nif")

    if isinstance(vendor_address, list):
        vendor_address = ", ".join([str(part) for part in vendor_address if part])
    if isinstance(vendor_contact, dict):
        vendor_contact = ", ".join([f"{key}: {value}" for key, value in vendor_contact.items() if value])
    elif isinstance(vendor_contact, list):
        vendor_contact = ", ".join([str(part) for part in vendor_contact if part])

    vendor, customer_name, supplier_nif, customer_nif = _maybe_correct_parties(
        vendor,
        customer_name,
        supplier_nif,
        customer_nif,
        text,
        correction_message=correction_message,
    )

    if _is_swap_parties_correction(correction_message):
        vendor, customer_name = customer_name or vendor, vendor
        supplier_nif, customer_nif = customer_nif, supplier_nif

    if _looks_like_placeholder_vendor_name(vendor):
        vendor = None

    category = guess_category(f"{vendor} {text} {ai_data.get('notes', '')}")

    subtotal = _to_decimal(ai_data.get("subtotal"))

    qr_line_items = _extract_qr_line_items(qr_data) if qr_data else []
    ai_line_items = ai_data.get("line_items")
    line_item_source = _select_line_item_source(qr_line_items, ai_line_items)

    result = {
        "vendor": vendor,
        "vendor_address": vendor_address,
        "vendor_contact": vendor_contact,
        "category": category,
        "subtotal": subtotal,
        "tax": _to_decimal(ai_data.get("tax")),
        "total": _to_decimal(ai_data.get("total")),
        "supplier_nif": supplier_nif,
        "customer_name": customer_name,
        "customer_nif": customer_nif,
        "invoice_number": ai_data.get("invoice_number"),
        "invoice_date": ai_data.get("invoice_date"),
        "due_date": ai_data.get("due_date"),
        "currency": ai_data.get("currency") or "EUR",
        "raw_text": text,
        "ai_payload": json.dumps(ai_data, ensure_ascii=False),
        "extraction_model": settings.extraction_model,
        "token_input": usage["input"],
        "token_output": usage["output"],
        "token_total": usage["total"],
        "notes": ai_data.get("notes") or f"Documento processado por IA: {file_name}",
        "line_items": _normalize_line_items(
            line_item_source,
            fallback_description=None if qr_data else (vendor or file_name),
            subtotal=subtotal,
        ),
    }

    result = _apply_deterministic_corrections(result, text=text, correction_message=correction_message)

    for field in ("vendor", "vendor_address", "vendor_contact", "customer_name", "notes"):
        result[field] = _collapse_broken_words(result.get(field))

    for item in result["line_items"]:
        item["description"] = _collapse_broken_words(item.get("description"))

    return result
