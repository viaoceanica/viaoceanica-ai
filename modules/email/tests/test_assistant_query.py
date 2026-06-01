import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "")

MODULE_ROOT = Path(__file__).resolve().parents[1]
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

import main


def test_inbox_count_question_sets_exact_inbox_folder_scope() -> None:
    filters = main.extract_email_query_filters("Quantos emails tenho na inbox?")

    assert filters["folder_query"] == "inbox"


def test_inbox_folder_word_is_not_treated_as_keyword() -> None:
    terms = main.extract_keyword_terms("Quantos emails tenho na inbox?", [], [], [])

    assert "inbox" not in terms


def test_deictic_archive_command_does_not_create_broad_keywords() -> None:
    assert main.request_targets_selected_email("Arquiva este email") is True

    terms = main.extract_keyword_terms("Arquiva este email", [], [], [])

    assert terms == []



def test_year_count_question_sets_full_year_received_range() -> None:
    filters = main.extract_email_query_filters("Quantos emails em 2026 tenho do Tony Silva?")

    assert filters["received_after"].isoformat() == "2026-01-01T00:00:00"
    assert filters["received_before"].isoformat() == "2027-01-01T00:00:00"


def test_portuguese_year_follow_up_sets_full_year_received_range_without_keyword_noise() -> None:
    filters = main.extract_email_query_filters("No ano 2026?")
    terms = main.extract_keyword_terms("No ano 2026?", [], [], [])

    assert filters["received_after"].isoformat() == "2026-01-01T00:00:00"
    assert filters["received_before"].isoformat() == "2027-01-01T00:00:00"
    assert terms == []


def test_relative_year_filters_are_supported() -> None:
    now = main.datetime.utcnow()
    filters = main.extract_email_query_filters("Quantos emails recebi este ano?")

    assert filters["received_after"].year == now.year
    assert filters["received_after"].month == 1
    assert filters["received_after"].day == 1
    assert filters["received_before"].year == now.year + 1
