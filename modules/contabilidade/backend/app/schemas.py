import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field




class InvoiceCorrectionBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    message: str
    created_at: datetime


class InvoiceLineItemBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: Optional[str] = None
    description: Optional[str] = None
    normalized_description: Optional[str] = None
    quantity: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    line_subtotal: Optional[Decimal] = None
    line_tax_amount: Optional[Decimal] = None
    line_total: Optional[Decimal] = None
    tax_rate: Optional[Decimal] = None
    tax_rate_source: Optional[str] = None
    catalog_item_id: Optional[uuid.UUID] = None
    raw_unit: Optional[str] = None
    normalized_unit: Optional[str] = None
    measurement_type: Optional[str] = None
    normalized_quantity: Optional[Decimal] = None
    normalized_unit_price: Optional[Decimal] = None
    line_category: Optional[str] = None
    line_type: Optional[str] = None
    normalization_confidence: Optional[Decimal] = None
    needs_review: bool = False
    review_reason: Optional[str] = None


class InvoiceLineItemUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Optional[uuid.UUID] = None
    code: Optional[str] = None
    description: Optional[str] = None
    raw_unit: Optional[str] = None
    quantity: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    line_subtotal: Optional[Decimal] = None
    line_tax_amount: Optional[Decimal] = None
    line_total: Optional[Decimal] = None
    tax_rate: Optional[Decimal] = None


class LearningDebugInfo(BaseModel):
    vendor_profile_applied: bool = False
    vendor_profile_score: Optional[int] = None
    vendor_profile_match_key: Optional[str] = None
    vendor_profile_vendor_name: Optional[str] = None
    invoice_template_applied: bool = False
    invoice_template_score: Optional[int] = None
    invoice_template_invoice_number: Optional[str] = None
    invoice_template_supplier_nif: Optional[str] = None


class InvoiceBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: str
    filename: str
    storage_object_key: Optional[str] = None
    vendor: Optional[str] = None
    vendor_address: Optional[str] = None
    vendor_contact: Optional[str] = None
    category: Optional[str] = None
    subtotal: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    total: Optional[Decimal] = None
    supplier_nif: Optional[str] = None
    customer_name: Optional[str] = None
    customer_nif: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: Optional[str] = None
    raw_text: Optional[str] = None
    ai_payload: Optional[str] = None
    extraction_model: Optional[str] = None
    token_input: Optional[int] = None
    token_output: Optional[int] = None
    token_total: Optional[int] = None
    confidence_score: Optional[Decimal] = None
    requires_review: bool = False
    notes: Optional[str] = None
    line_items: list[InvoiceLineItemBase] = []
    learning_debug: Optional[LearningDebugInfo] = None
    status: str
    created_at: datetime


class InvoiceListResponse(BaseModel):
    items: list[InvoiceBase]


class TenantProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company_name: Optional[str] = None
    company_nif: Optional[str] = None


class TenantProfileResponse(BaseModel):
    company_name: Optional[str] = None
    company_nif: Optional[str] = None


class InvoiceUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor: Optional[str] = None
    vendor_address: Optional[str] = None
    vendor_contact: Optional[str] = None
    category: Optional[str] = None
    subtotal: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    total: Optional[Decimal] = None
    supplier_nif: Optional[str] = None
    customer_name: Optional[str] = None
    customer_nif: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    requires_review: Optional[bool] = None
    line_items: Optional[list[InvoiceLineItemUpdateRequest]] = None


class RejectedDocument(BaseModel):
    filename: str
    reason: str
    detected_type: Optional[str] = None


class FailedImportBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: str
    filename: str
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    reason: str
    detected_type: Optional[str] = None
    source: str
    retry_count: int = 0
    last_retry_at: Optional[datetime] = None
    created_at: datetime


class FailedImportListResponse(BaseModel):
    items: list[FailedImportBase]


class LineItemReviewRow(BaseModel):
    invoice_id: uuid.UUID
    invoice_number: Optional[str] = None
    vendor: Optional[str] = None
    filename: str
    created_at: datetime
    line_item_id: uuid.UUID
    position: Optional[Decimal] = None
    description: Optional[str] = None
    line_total: Optional[Decimal] = None
    tax_rate: Optional[Decimal] = None
    tax_rate_source: Optional[str] = None
    normalization_confidence: Optional[Decimal] = None
    review_reason: Optional[str] = None


class LineItemReviewListResponse(BaseModel):
    items: list[LineItemReviewRow]


class LineItemLabelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonical_name: str = Field(..., min_length=2, max_length=255)
    line_type: Optional[str] = None
    line_category: Optional[str] = None
    normalized_unit: Optional[str] = None


class LineItemBulkLabelResponse(BaseModel):
    line_item_id: uuid.UUID
    updated_count: int


class LineItemSuggestion(BaseModel):
    canonical_name: str
    display_name: Optional[str] = None
    line_type: Optional[str] = None
    line_category: Optional[str] = None
    normalized_unit: Optional[str] = None
    confidence: Optional[Decimal] = None
    source: str = "alias"


class LineItemSuggestionListResponse(BaseModel):
    items: list[LineItemSuggestion]


class LineItemQualitySummary(BaseModel):
    total_lines: int = 0
    mapped_lines: int = 0
    review_lines: int = 0
    mapped_rate_pct: Decimal = Decimal("0")


class AutomationBlockerRow(BaseModel):
    invoice_id: uuid.UUID
    invoice_number: Optional[str] = None
    filename: str
    vendor: Optional[str] = None
    code: str
    severity: str
    message: str
    created_at: datetime


class AutomationBlockerListResponse(BaseModel):
    items: list[AutomationBlockerRow]


class IngestResponse(BaseModel):
    ingested: list[InvoiceBase]
    rejected: list[RejectedDocument] = []


class StorageUploadInitRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: Optional[str] = Field(None, max_length=128)
    file_size: Optional[int] = Field(None, gt=0, le=50 * 1024 * 1024)


class StorageUploadInitResponse(BaseModel):
    bucket: str
    object_key: str
    upload_url: str
    expires_in_seconds: int


class StorageUploadCompleteRequest(BaseModel):
    object_key: str = Field(..., min_length=1, max_length=1024)
    filename: Optional[str] = Field(None, min_length=1, max_length=255)
    content_type: Optional[str] = Field(None, max_length=128)


class InvoiceCorrectionRequest(BaseModel):
    message: str = Field(..., min_length=3, max_length=1000)


class InvoiceCorrectionListResponse(BaseModel):
    items: list[InvoiceCorrectionBase]


class ChatReference(BaseModel):
    invoice_id: uuid.UUID
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    score: Optional[float] = None


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=2000)
    top_k: int = Field(5, ge=1, le=10)


class ChatResponse(BaseModel):
    answer: str
    references: list[ChatReference]


class CostTrendPoint(BaseModel):
    invoice_id: uuid.UUID
    invoice_number: Optional[str] = None
    vendor: Optional[str] = None
    created_at: datetime
    description: Optional[str] = None
    canonical_item: Optional[str] = None
    normalized_unit: Optional[str] = None
    normalized_quantity: Optional[Decimal] = None
    normalized_unit_price: Optional[Decimal] = None


class CostTrendSummary(BaseModel):
    current_avg_unit_price: Optional[Decimal] = None
    previous_avg_unit_price: Optional[Decimal] = None
    pct_change: Optional[Decimal] = None
    sample_size_current: int = 0
    sample_size_previous: int = 0
    days: int = 90
    vendor: Optional[str] = None
    item_query: str


class CostTrendResponse(BaseModel):
    summary: CostTrendSummary
    points: list[CostTrendPoint]


class UploadTelemetryEventRequest(BaseModel):
    step: str = Field(..., pattern="^(validate|extract|review|save)$")
    status: str = Field(..., pattern="^(enter|success|failure)$")
    session_id: Optional[str] = Field(None, max_length=128)
    context: Optional[str] = Field(None, max_length=256)
    timestamp: Optional[datetime] = None


class UploadTelemetryStepSummary(BaseModel):
    step: str
    enter: int = 0
    success: int = 0
    failure: int = 0


class UploadTelemetryFunnelResponse(BaseModel):
    tenant_id: str
    total_events: int
    steps: list[UploadTelemetryStepSummary]
    generated_at: datetime
