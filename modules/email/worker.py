from __future__ import annotations

import os
import time

from sqlalchemy import select

from main import Mailbox, get_db_session, logger, sync_mailbox_messages

EMAIL_SYNC_INTERVAL_SECONDS = max(30, int(os.getenv("EMAIL_SYNC_INTERVAL_SECONDS", "300")))


def run_sync_cycle() -> dict:
    summary = {
        "mailboxes_seen": 0,
        "mailboxes_synced": 0,
        "mailboxes_failed": 0,
    }

    with get_db_session() as session:
        mailboxes = session.scalars(
            select(Mailbox).where(Mailbox.sync_enabled.is_(True)).order_by(Mailbox.updated_at.asc())
        ).all()

        summary["mailboxes_seen"] = len(mailboxes)

        for mailbox in mailboxes:
            try:
                result = sync_mailbox_messages(session, mailbox)
                summary["mailboxes_synced"] += 1
                logger.info(
                    "[email-worker] synced mailbox=%s tenant=%s fetched=%s created=%s updated=%s",
                    mailbox.id,
                    mailbox.tenant_id,
                    result.get("fetched", 0),
                    result.get("created", 0),
                    result.get("updated", 0),
                )
            except Exception as exc:
                summary["mailboxes_failed"] += 1
                logger.warning(
                    "[email-worker] failed mailbox=%s tenant=%s error=%s",
                    mailbox.id,
                    mailbox.tenant_id,
                    exc,
                )

    return summary


def main() -> None:
    logger.info("[email-worker] starting, interval=%ss", EMAIL_SYNC_INTERVAL_SECONDS)
    while True:
        try:
            summary = run_sync_cycle()
            logger.info(
                "[email-worker] cycle complete seen=%s synced=%s failed=%s",
                summary["mailboxes_seen"],
                summary["mailboxes_synced"],
                summary["mailboxes_failed"],
            )
        except Exception as exc:
            logger.exception("[email-worker] cycle crashed: %s", exc)

        time.sleep(EMAIL_SYNC_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
