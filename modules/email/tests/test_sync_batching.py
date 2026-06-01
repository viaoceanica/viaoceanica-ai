import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "")

MODULE_ROOT = Path(__file__).resolve().parents[1]
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

import main
import worker


def test_iter_imap_sequence_ranges_covers_full_mailbox() -> None:
    assert main.iter_imap_sequence_ranges(0, batch_size=250) == []
    assert main.iter_imap_sequence_ranges(1, batch_size=250) == [(1, 1)]
    assert main.iter_imap_sequence_ranges(1200, batch_size=500) == [(701, 1200), (201, 700), (1, 200)]


def test_parse_fetch_payloads_keeps_multiple_messages() -> None:
    fetch_data = [
        (b'1 (UID 101 FLAGS (\\Seen) BODY[] {12}', b'raw-email-01'),
        (b'2 (UID 102 FLAGS () BODY[] {12}', b'raw-email-02'),
    ]

    records = main.parse_fetch_payloads(fetch_data)

    assert [main.parse_imap_uid(meta) for meta, _ in records] == ["101", "102"]
    assert [main.parse_imap_flags(meta) for meta, _ in records] == [{"\\Seen"}, set()]
    assert [raw for _, raw in records] == [b"raw-email-01", b"raw-email-02"]


def test_parse_fetch_payloads_skips_malformed_entries() -> None:
    fetch_data = [
        b"stray bytes",
        (b"bad metadata without body",),
        (b"3 (UID 103 FLAGS (\\Flagged) BODY[] {12}", b"raw-email-03"),
    ]

    records = main.parse_fetch_payloads(fetch_data)

    assert len(records) == 1
    assert main.parse_imap_uid(records[0][0]) == "103"
    assert records[0][1] == b"raw-email-03"


def test_truncate_helpers_bound_database_strings() -> None:
    assert main.truncate_or_none(None, 10) is None
    assert main.truncate_or_none("", 10) is None
    assert main.truncate_or_none("  abc  ", 10) == "abc"
    assert main.truncate_or_none("x" * 300, 255) == "x" * 255
    assert main.truncate_or_default("", 5, "INBOX") == "INBOX"
    assert main.truncate_or_default("abcdef", 5, "INBOX") == "abcde"


def test_embedding_vector_validation_rejects_malformed_shapes() -> None:
    assert main.is_valid_embedding_vector([1, 2.5, 3]) is True
    assert main.is_valid_embedding_vector([]) is False
    assert main.is_valid_embedding_vector(["1", 2]) is False
    assert main.is_valid_embedding_vector([[1], 2]) is False
    assert main.is_valid_embedding_vector([True, 2]) is False
    assert main.extract_embedding_from_response({"embedding": [1, 2.5]}) == [1.0, 2.5]
    assert main.extract_embedding_from_response({"embedding": ["bad", 2]}) is None


def test_worker_rolls_back_before_touching_mailbox_after_sync_error(monkeypatch) -> None:
    class FakeMailbox:
        def __init__(self) -> None:
            self.id_reads = 0
            self.tenant_reads = 0

        @property
        def id(self) -> str:
            self.id_reads += 1
            if self.id_reads > 1:
                raise AssertionError("mailbox.id was read after sync failure")
            return "mailbox-1"

        @property
        def tenant_id(self) -> str:
            self.tenant_reads += 1
            if self.tenant_reads > 1:
                raise AssertionError("mailbox.tenant_id was read after sync failure")
            return "tenant-1"

    class FakeScalars:
        def __init__(self, mailboxes):
            self.mailboxes = mailboxes

        def all(self):
            return self.mailboxes

    class FakeSession:
        def __init__(self, mailboxes):
            self.mailboxes = mailboxes
            self.rollback_called = False

        def scalars(self, _statement):
            return FakeScalars(self.mailboxes)

        def rollback(self):
            self.rollback_called = True

    class FakeSessionContext:
        def __init__(self, session):
            self.session = session

        def __enter__(self):
            return self.session

        def __exit__(self, exc_type, exc, tb):
            return False

    mailbox = FakeMailbox()
    session = FakeSession([mailbox])
    monkeypatch.setattr(worker, "get_db_session", lambda: FakeSessionContext(session))
    monkeypatch.setattr(worker, "sync_mailbox_quick", lambda _session, _mailbox: (_ for _ in ()).throw(RuntimeError("boom")))

    summary = worker.run_sync_cycle()

    assert summary == {"mailboxes_seen": 1, "mailboxes_synced": 0, "mailboxes_failed": 1}
    assert session.rollback_called is True
    assert mailbox.id_reads == 1
    assert mailbox.tenant_reads == 1



def test_sync_selected_folder_skips_bad_payload_and_continues(monkeypatch) -> None:
    class FakeMailbox:
        id = "mailbox-1"
        tenant_id = "tenant-1"
        folder = "INBOX"

    class FakeScalars:
        def all(self):
            return []

    class FakeSession:
        def __init__(self) -> None:
            self.added = []
            self.commits = 0
            self.rollbacks = 0

        def scalars(self, _statement):
            return FakeScalars()

        def scalar(self, _statement):
            return None

        def add(self, item):
            self.added.append(item)

        def commit(self):
            self.commits += 1

        def rollback(self):
            self.rollbacks += 1

    class FakeClient:
        def select(self, folder, readonly=True):
            assert folder == "INBOX.bad"
            return "OK", [b"2"]

        def uid(self, command, charset, criterion):
            assert (command, charset, criterion) == ("SEARCH", None, "ALL")
            return "OK", [b"101 102"]

        def fetch(self, batch_range, spec):
            assert batch_range == "1:2"
            assert spec == "(UID FLAGS BODY.PEEK[])"
            return "OK", [
                (b"1 (UID 101 FLAGS () BODY[] {3}", b"bad"),
                (b"2 (UID 102 FLAGS (\\Seen) BODY[] {4}", b"good"),
            ]

    def fake_parse_email_payload(raw_bytes: bytes):
        if raw_bytes == b"bad":
            raise IndexError("list index out of range")
        return main.ParsedEmailPayload(
            message_id_header="<good@example>",
            subject="Good",
            from_name="Sender",
            from_address="sender@example.com",
            to_addresses="to@example.com",
            snippet="body",
            body_text="body",
            body_html=None,
            received_at=None,
            has_attachments=False,
        )

    session = FakeSession()
    monkeypatch.setattr(main, "parse_email_payload", fake_parse_email_payload)
    monkeypatch.setattr(main, "sync_email_embedding", lambda _session, _item: False)

    result = main.sync_selected_folder(session, FakeClient(), FakeMailbox(), "INBOX.bad")

    assert result["fetched"] == 1
    assert result["created"] == 1
    assert result["skipped"] == 1
    assert len(session.added) == 1
    assert session.added[0].imap_uid == "102"
    assert session.rollbacks == 0


def test_parse_email_payload_falls_back_for_parser_edge_case(monkeypatch) -> None:
    class ExplodingParser:
        def __init__(self, *args, **kwargs):
            pass

        def parsebytes(self, _raw_bytes):
            raise AttributeError("'str' object has no attribute 'token_type'")

    monkeypatch.setattr(main, "BytesParser", ExplodingParser)

    payload = main.parse_email_payload(
        b"Subject: Fallback subject\r\nFrom: Sender <sender@example.com>\r\nTo: to@example.com\r\n\r\nFallback body"
    )

    assert payload.subject == "Fallback subject"
    assert payload.from_address == "sender@example.com"
    assert payload.to_addresses == "to@example.com"
    assert payload.body_text == "Fallback body"

def test_clear_mailbox_folder_error_removes_successful_folder_only() -> None:
    class FakeMailbox:
        last_error = "INBOX.Archive: list index out of range; INBOX.spam: parser token_type failure; INBOX.Trash: list index out of range"
        updated_at = None

    mailbox = FakeMailbox()

    main.clear_mailbox_folder_error(mailbox, "INBOX.spam")

    assert "INBOX.spam" not in mailbox.last_error
    assert "INBOX.Archive: list index out of range" in mailbox.last_error
    assert "INBOX.Trash: list index out of range" in mailbox.last_error
    assert mailbox.updated_at is not None


def test_clear_mailbox_folder_error_clears_final_stale_error() -> None:
    class FakeMailbox:
        last_error = "INBOX.contabilidade: list index out of range"
        updated_at = None

    mailbox = FakeMailbox()

    main.clear_mailbox_folder_error(mailbox, "INBOX.contabilidade")

    assert mailbox.last_error is None
    assert mailbox.updated_at is not None

