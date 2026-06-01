from __future__ import annotations

import os
import time

from sqlalchemy import select

from main import (
    Mailbox,
    clear_mailbox_folder_error,
    close_imap_client,
    decrypt_secret,
    get_db_session,
    logger,
    open_imap_connection,
    quick_sync_folder,
    utc_now,
)

EMAIL_SYNC_INTERVAL_SECONDS = max(30, int(os.getenv("EMAIL_SYNC_INTERVAL_SECONDS", "300")))


def sync_mailbox_quick(session, mailbox: Mailbox) -> dict:
    # Lightweight background sync. Full historical sync remains manual/admin-only.
    if not mailbox.imap_password_encrypted:
        raise RuntimeError("mailbox password is not stored")
    if not mailbox.imap_host or not mailbox.imap_port or not mailbox.imap_username:
        raise RuntimeError("mailbox IMAP settings are incomplete")

    password = decrypt_secret(mailbox.imap_password_encrypted)

    def connect(selected_folder: str):
        client, _ = open_imap_connection(
            host=mailbox.imap_host,
            port=int(mailbox.imap_port),
            username=mailbox.imap_username,
            password=password,
            security_mode=mailbox.security_mode or "ssl_tls",
            validate_certificates=bool(mailbox.validate_certificates),
            folder=selected_folder,
            readonly=True,
        )
        return client

    client = None
    folder_results: list[dict] = []
    folder_failures: list[dict] = []
    try:
        base_folder = mailbox.folder or "INBOX"
        client = connect(base_folder)
        # Background polling must stay fast enough to honor the configured interval.
        # Full all-folder sync remains available through manual/admin sync paths.
        folders = [base_folder]
        for folder in folders:
            try:
                result = quick_sync_folder(session, client, mailbox, folder)
                folder_results.append(result)
                clear_mailbox_folder_error(mailbox, folder)
                session.commit()
            except Exception as exc:
                try:
                    session.rollback()
                except Exception:
                    pass
                logger.warning("[email-worker] quick sync failed folder=%s mailbox=%s error=%s", folder, mailbox.id, exc)
                folder_failures.append({"folder": folder, "error": str(exc)})

        if not folder_results:
            failure_message = "; ".join(f"{entry['folder']}: {entry['error']}" for entry in folder_failures) or "no folders synced"
            raise RuntimeError(failure_message)

        mailbox.status = "connected"
        mailbox.last_error = "; ".join(f"{entry['folder']}: {entry['error']}" for entry in folder_failures) if folder_failures else None
        mailbox.last_synced_at = utc_now()
        mailbox.updated_at = utc_now()
        session.add(mailbox)
        session.commit()

        return {
            "fetched": sum(int(item.get("fetched", 0)) for item in folder_results),
            "created": sum(int(item.get("created", 0)) for item in folder_results),
            "updated": sum(int(item.get("updated", 0)) for item in folder_results),
            "reconciled": sum(int(item.get("reconciled", 0)) for item in folder_results),
            "folders_synced": len(folder_results),
            "folders_failed": len(folder_failures),
        }
    finally:
        close_imap_client(client)


def run_sync_cycle() -> dict:
    summary = {"mailboxes_seen": 0, "mailboxes_synced": 0, "mailboxes_failed": 0}
    with get_db_session() as session:
        mailboxes = session.scalars(select(Mailbox).where(Mailbox.sync_enabled.is_(True)).order_by(Mailbox.updated_at.asc())).all()
        summary["mailboxes_seen"] = len(mailboxes)
        for mailbox in mailboxes:
            mailbox_id = str(mailbox.id)
            tenant_id = str(mailbox.tenant_id)
            try:
                result = sync_mailbox_quick(session, mailbox)
                summary["mailboxes_synced"] += 1
                logger.info(
                    "[email-worker] quick synced mailbox=%s tenant=%s folders=%s failed_folders=%s fetched=%s created=%s updated=%s reconciled=%s",
                    mailbox_id,
                    tenant_id,
                    result.get("folders_synced", 0),
                    result.get("folders_failed", 0),
                    result.get("fetched", 0),
                    result.get("created", 0),
                    result.get("updated", 0),
                    result.get("reconciled", 0),
                )
            except Exception as exc:
                summary["mailboxes_failed"] += 1
                try:
                    session.rollback()
                except Exception as rollback_exc:
                    logger.warning("[email-worker] rollback failed mailbox=%s tenant=%s error=%s", mailbox_id, tenant_id, rollback_exc)
                logger.warning("[email-worker] failed mailbox=%s tenant=%s error=%s", mailbox_id, tenant_id, exc)
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
