from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = "postgresql+psycopg2://viacontab:viacontab@postgres:5432/viacontab"
    qdrant_url: str = "http://qdrant:6333"
    openai_api_key: str = ""
    nif_lookup_key: str = Field("", validation_alias="NIF_PT_API_KEY")
    extraction_model: str = "gpt-5.4-mini"
    embedding_model: str = "text-embedding-3-small"
    debug_learning: bool = False
    skip_db_init: bool = False
    allowed_origins: list[str] = Field(default_factory=lambda: ["*"])

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    r2_endpoint: str = ""
    r2_presign_expiry_seconds: int = 300


@lru_cache
def get_settings() -> Settings:
    return Settings()
