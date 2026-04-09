import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    storage_object_key = Column(String(1024), nullable=True)
    vendor = Column(String(255), nullable=True)
    vendor_address = Column(Text, nullable=True)
    vendor_contact = Column(String(255), nullable=True)
    category = Column(String(64), nullable=True)
    subtotal = Column(Numeric(12, 2), nullable=True)
    tax = Column(Numeric(12, 2), nullable=True)
    total = Column(Numeric(12, 2), nullable=True)
    supplier_nif = Column(String(128), nullable=True)
    customer_name = Column(String(255), nullable=True)
    customer_nif = Column(String(128), nullable=True)
    invoice_number = Column(String(128), nullable=True)
    invoice_date = Column(String(32), nullable=True)
    due_date = Column(String(32), nullable=True)
    currency = Column(String(16), nullable=True)
    raw_text = Column(Text, nullable=True)
    ai_payload = Column(Text, nullable=True)
    extraction_model = Column(String(128), nullable=True)
    token_input = Column(Integer, nullable=True)
    token_output = Column(Integer, nullable=True)
    token_total = Column(Integer, nullable=True)
    confidence_score = Column(Numeric(5, 2), nullable=True)
    requires_review = Column(Boolean, nullable=False, default=False)
    learning_debug = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="processed")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    line_items = relationship(
        "InvoiceLineItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLineItem.position",
    )
    corrections = relationship(
        "InvoiceCorrection",
        back_populates="invoice",
        cascade="all, delete-orphan",
    )


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Numeric(6, 0), nullable=False, default=0)
    code = Column(String(128), nullable=True)
    description = Column(Text, nullable=True)
    normalized_description = Column(Text, nullable=True)
    quantity = Column(Numeric(12, 2), nullable=True)
    unit_price = Column(Numeric(12, 2), nullable=True)
    line_subtotal = Column(Numeric(12, 2), nullable=True)
    line_tax_amount = Column(Numeric(12, 2), nullable=True)
    line_total = Column(Numeric(12, 2), nullable=True)
    tax_rate = Column(Numeric(5, 2), nullable=True)
    tax_rate_source = Column(String(32), nullable=True)
    catalog_item_id = Column(UUID(as_uuid=True), ForeignKey("catalog_items.id"), nullable=True, index=True)
    raw_unit = Column(String(32), nullable=True)
    normalized_unit = Column(String(32), nullable=True)
    measurement_type = Column(String(32), nullable=True)
    normalized_quantity = Column(Numeric(12, 3), nullable=True)
    normalized_unit_price = Column(Numeric(12, 4), nullable=True)
    line_category = Column(String(64), nullable=True)
    line_type = Column(String(32), nullable=True)
    normalization_confidence = Column(Numeric(5, 2), nullable=True)
    needs_review = Column(Boolean, nullable=False, default=False)
    review_reason = Column(Text, nullable=True)

    invoice = relationship("Invoice", back_populates="line_items")
    catalog_item = relationship("CatalogItem", back_populates="line_items")


class InvoiceCorrection(Base):
    __tablename__ = "invoice_corrections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    message = Column(Text, nullable=False)
    ai_payload = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="corrections")


class InvoiceTemplate(Base):
    __tablename__ = "invoice_templates"
    __table_args__ = (
        UniqueConstraint("tenant_id", "invoice_number", "supplier_nif", name="uq_invoice_template"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    invoice_number = Column(String(128), nullable=False)
    supplier_nif = Column(String(128), nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class VendorProfile(Base):
    __tablename__ = "vendor_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "supplier_nif", name="uq_vendor_profile_nif"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    supplier_nif = Column(String(128), nullable=False)
    vendor_name = Column(String(255), nullable=True)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TenantProfile(Base):
    __tablename__ = "tenant_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_profile_tenant"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    company_name = Column(String(255), nullable=True)
    company_nif = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CatalogItem(Base):
    __tablename__ = "catalog_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "canonical_name", name="uq_catalog_item_tenant_name"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    canonical_name = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    category_path = Column(String(255), nullable=True)
    item_type = Column(String(32), nullable=True)
    measurement_type = Column(String(32), nullable=True)
    base_unit = Column(String(32), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    aliases = relationship("CatalogAlias", back_populates="catalog_item", cascade="all, delete-orphan")
    line_items = relationship("InvoiceLineItem", back_populates="catalog_item")


class CatalogAlias(Base):
    __tablename__ = "catalog_aliases"
    __table_args__ = (
        UniqueConstraint("tenant_id", "normalized_label", name="uq_catalog_alias_tenant_label"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    raw_label = Column(String(255), nullable=False)
    normalized_label = Column(String(255), nullable=False, index=True)
    catalog_item_id = Column(UUID(as_uuid=True), ForeignKey("catalog_items.id", ondelete="CASCADE"), nullable=False)
    confidence = Column(Numeric(5, 2), nullable=True)
    source = Column(String(32), nullable=False, default="learned")
    usage_confirmed_count = Column(Integer, nullable=False, default=0)
    usage_auto_apply_count = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    catalog_item = relationship("CatalogItem", back_populates="aliases")


class FailedImport(Base):
    __tablename__ = "failed_imports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    mime_type = Column(String(128), nullable=True)
    file_size = Column(Integer, nullable=True)
    file_blob = Column(LargeBinary, nullable=True)
    reason = Column(Text, nullable=False)
    detected_type = Column(String(128), nullable=True)
    source = Column(String(32), nullable=False, default="upload")
    retry_count = Column(Integer, nullable=False, default=0)
    last_retry_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class StorageUploadQueue(Base):
    __tablename__ = "storage_upload_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String(64), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(128), nullable=True)
    file_size = Column(Integer, nullable=False)
    file_blob = Column(LargeBinary, nullable=False)
    status = Column(String(32), nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    object_key = Column(String(1024), nullable=True)
    next_retry_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
