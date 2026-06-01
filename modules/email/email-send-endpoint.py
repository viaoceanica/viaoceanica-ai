
# ─── Email Send/Reply/Forward Endpoint ─────────────────────────────────────
# Add this code before the `if __name__ == "__main__":` block in main.py

class EmailSendRequest(BaseModel):
    """Request model for sending emails (reply, reply_all, forward, new)."""
    mode: Literal["reply", "reply_all", "forward", "new"] = "reply"
    to: str = Field(min_length=3, max_length=2048, description="Comma-separated recipient addresses")
    cc: Optional[str] = Field(default=None, max_length=2048, description="Comma-separated CC addresses")
    subject: str = Field(min_length=1, max_length=512)
    body_html: str = Field(min_length=1, description="HTML body of the email")
    body_text: Optional[str] = Field(default=None, description="Plain text fallback")
    in_reply_to: Optional[str] = Field(default=None, max_length=512, description="Message-ID of the email being replied to")

    @field_validator("to", "cc")
    @classmethod
    def strip_addresses(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


def send_email_via_smtp(
    *,
    mailbox: "Mailbox",
    password: str,
    from_address: str,
    to_addresses: list[str],
    cc_addresses: list[str],
    subject: str,
    body_html: str,
    body_text: str | None,
    in_reply_to: str | None,
    references: str | None,
) -> None:
    """Send an email using SMTP with the mailbox credentials."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formataddr, formatdate, make_msgid

    msg = MIMEMultipart("alternative")
    msg["From"] = formataddr((mailbox.name or "", from_address))
    msg["To"] = ", ".join(to_addresses)
    if cc_addresses:
        msg["Cc"] = ", ".join(cc_addresses)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=from_address.split("@")[-1] if "@" in from_address else "viaoceanica.com")

    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    # Add plain text part
    if body_text:
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
    else:
        # Generate plain text from HTML (basic strip)
        import re as _re
        plain = _re.sub(r"<[^>]+>", "", body_html)
        plain = _re.sub(r"\s+", " ", plain).strip()
        msg.attach(MIMEText(plain, "plain", "utf-8"))

    # Add HTML part
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    # Determine all recipients
    all_recipients = list(to_addresses)
    if cc_addresses:
        all_recipients.extend(cc_addresses)

    # Connect and send via SMTP (port 587 STARTTLS)
    smtp_host = mailbox.imap_host  # Same host for IMAP and SMTP
    smtp_port = 587
    smtp_username = mailbox.imap_username

    ctx = ssl.create_default_context()
    if not mailbox.validate_certificates:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
    try:
        server.ehlo()
        server.starttls(context=ctx)
        server.ehlo()
        server.login(smtp_username, password)
        server.sendmail(from_address, all_recipients, msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


@app.post("/api/v1/emails/{email_id}/send")
async def send_email_reply(email_id: str, request: Request, payload: EmailSendRequest):
    """Send a reply, reply-all, or forward for an existing email."""
    with get_db_session() as session:
        item = get_email_or_404(session, request.state.tenant_id, email_id)
        mailbox = get_mailbox_or_404(session, request.state.tenant_id, item.mailbox_id)

        if mailbox.access_mode != "read_write":
            raise HTTPException(status_code=409, detail="A mailbox está configurada em modo só de leitura")
        if not mailbox.imap_password_encrypted:
            raise HTTPException(status_code=422, detail="A palavra-passe da mailbox não está guardada")
        if not mailbox.imap_host or not mailbox.imap_username:
            raise HTTPException(status_code=422, detail="É necessário configurar o host e utilizador da mailbox")

        password = decrypt_secret(mailbox.imap_password_encrypted)
        from_address = mailbox.email_address

        # Parse recipients
        to_list = [addr.strip() for addr in payload.to.split(",") if addr.strip()]
        cc_list = [addr.strip() for addr in (payload.cc or "").split(",") if addr.strip()]

        if not to_list:
            raise HTTPException(status_code=422, detail="É necessário pelo menos um destinatário")

        # Build references chain
        references = None
        if payload.in_reply_to:
            references = payload.in_reply_to
            # Could extend with full references chain if stored

        try:
            send_email_via_smtp(
                mailbox=mailbox,
                password=password,
                from_address=from_address,
                to_addresses=to_list,
                cc_addresses=cc_list,
                subject=payload.subject,
                body_html=payload.body_html,
                body_text=payload.body_text,
                in_reply_to=payload.in_reply_to,
                references=references,
            )
        except smtplib.SMTPAuthenticationError as exc:
            logger.error("[email-send] SMTP auth failed for %s: %s", from_address, exc)
            raise HTTPException(status_code=401, detail="Falha na autenticação SMTP. Verifique as credenciais da mailbox.")
        except smtplib.SMTPRecipientsRefused as exc:
            logger.error("[email-send] Recipients refused: %s", exc)
            raise HTTPException(status_code=422, detail=f"Destinatário(s) recusado(s): {exc}")
        except Exception as exc:
            logger.error("[email-send] SMTP error for %s: %s", from_address, exc)
            raise HTTPException(status_code=500, detail=f"Erro ao enviar email: {str(exc)}")

        # Update mailbox status
        mailbox.status = "connected"
        mailbox.last_synced_at = utc_now()
        session.commit()

        return {
            "success": True,
            "data": {
                "message": "Email enviado com sucesso",
                "from": from_address,
                "to": to_list,
                "cc": cc_list,
                "subject": payload.subject,
            }
        }


@app.post("/api/v1/emails/compose")
async def compose_new_email(request: Request, payload: EmailSendRequest):
    """Compose and send a new email (not a reply)."""
    tenant_id = request.state.tenant_id
    with get_db_session() as session:
        # Get the first read_write mailbox for this tenant
        mailbox = session.query(Mailbox).filter(
            Mailbox.tenant_id == tenant_id,
            Mailbox.access_mode == "read_write",
            Mailbox.imap_password_encrypted.isnot(None),
        ).first()

        if not mailbox:
            raise HTTPException(status_code=404, detail="Nenhuma mailbox com permissão de escrita encontrada")
        if not mailbox.imap_host or not mailbox.imap_username:
            raise HTTPException(status_code=422, detail="É necessário configurar o host e utilizador da mailbox")

        password = decrypt_secret(mailbox.imap_password_encrypted)
        from_address = mailbox.email_address

        to_list = [addr.strip() for addr in payload.to.split(",") if addr.strip()]
        cc_list = [addr.strip() for addr in (payload.cc or "").split(",") if addr.strip()]

        if not to_list:
            raise HTTPException(status_code=422, detail="É necessário pelo menos um destinatário")

        try:
            send_email_via_smtp(
                mailbox=mailbox,
                password=password,
                from_address=from_address,
                to_addresses=to_list,
                cc_addresses=cc_list,
                subject=payload.subject,
                body_html=payload.body_html,
                body_text=payload.body_text,
                in_reply_to=payload.in_reply_to,
                references=payload.in_reply_to,
            )
        except smtplib.SMTPAuthenticationError as exc:
            logger.error("[email-compose] SMTP auth failed for %s: %s", from_address, exc)
            raise HTTPException(status_code=401, detail="Falha na autenticação SMTP. Verifique as credenciais da mailbox.")
        except smtplib.SMTPRecipientsRefused as exc:
            logger.error("[email-compose] Recipients refused: %s", exc)
            raise HTTPException(status_code=422, detail=f"Destinatário(s) recusado(s): {exc}")
        except Exception as exc:
            logger.error("[email-compose] SMTP error for %s: %s", from_address, exc)
            raise HTTPException(status_code=500, detail=f"Erro ao enviar email: {str(exc)}")

        mailbox.status = "connected"
        mailbox.last_synced_at = utc_now()
        session.commit()

        return {
            "success": True,
            "data": {
                "message": "Email enviado com sucesso",
                "from": from_address,
                "to": to_list,
                "cc": cc_list,
                "subject": payload.subject,
            }
        }
