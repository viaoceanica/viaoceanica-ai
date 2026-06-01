#!/usr/bin/env python3
"""Inject the email send endpoint into main.py"""
import re

# Read current main.py
with open('/app/main.py', 'r') as f:
    content = f.read()

new_code = '''

# --- Email Send/Reply/Forward Endpoint ---

class EmailSendRequest(BaseModel):
    mode: Literal["reply", "reply_all", "forward", "new"] = "reply"
    to: str = Field(min_length=3, max_length=2048)
    cc: Optional[str] = Field(default=None, max_length=2048)
    subject: str = Field(min_length=1, max_length=512)
    body_html: str = Field(min_length=1)
    body_text: Optional[str] = Field(default=None)
    in_reply_to: Optional[str] = Field(default=None, max_length=512)

    @field_validator("to", "cc")
    @classmethod
    def strip_addresses(cls, value):
        if value is None:
            return None
        return value.strip()


def send_email_via_smtp(
    *,
    mailbox,
    password: str,
    from_address: str,
    to_addresses: list,
    cc_addresses: list,
    subject: str,
    body_html: str,
    body_text=None,
    in_reply_to=None,
    references=None,
):
    import smtplib as _smtplib
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
    domain = from_address.split("@")[-1] if "@" in from_address else "viaoceanica.com"
    msg["Message-ID"] = make_msgid(domain=domain)
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    if body_text:
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
    else:
        plain = re.sub(r"<[^>]+>", "", body_html)
        plain = re.sub(r"\\s+", " ", plain).strip()
        msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    all_recipients = list(to_addresses)
    if cc_addresses:
        all_recipients.extend(cc_addresses)

    smtp_host = mailbox.imap_host
    smtp_port = 587
    smtp_username = mailbox.imap_username

    ctx = ssl.create_default_context()
    if not mailbox.validate_certificates:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    server = _smtplib.SMTP(smtp_host, smtp_port, timeout=30)
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
            raise HTTPException(status_code=409, detail="A mailbox esta configurada em modo so de leitura")
        if not mailbox.imap_password_encrypted:
            raise HTTPException(status_code=422, detail="A palavra-passe da mailbox nao esta guardada")
        if not mailbox.imap_host or not mailbox.imap_username:
            raise HTTPException(status_code=422, detail="E necessario configurar o host e utilizador da mailbox")
        password = decrypt_secret(mailbox.imap_password_encrypted)
        from_address = mailbox.email_address
        to_list = [addr.strip() for addr in payload.to.split(",") if addr.strip()]
        cc_list = [addr.strip() for addr in (payload.cc or "").split(",") if addr.strip()]
        if not to_list:
            raise HTTPException(status_code=422, detail="E necessario pelo menos um destinatario")
        references = payload.in_reply_to
        try:
            send_email_via_smtp(
                mailbox=mailbox, password=password, from_address=from_address,
                to_addresses=to_list, cc_addresses=cc_list, subject=payload.subject,
                body_html=payload.body_html, body_text=payload.body_text,
                in_reply_to=payload.in_reply_to, references=references,
            )
        except Exception as exc:
            logger.error("[email-send] SMTP error for %s: %s", from_address, exc)
            raise HTTPException(status_code=500, detail="Erro ao enviar email: " + str(exc))
        mailbox.status = "connected"
        mailbox.last_synced_at = utc_now()
        session.commit()
        return {"success": True, "data": {"message": "Email enviado com sucesso", "from": from_address, "to": to_list, "cc": cc_list, "subject": payload.subject}}

'''

# Insert before the if __name__ block
insertion_point = content.rfind('if __name__ == "__main__":')
if insertion_point == -1:
    print('ERROR: Could not find insertion point')
else:
    new_content = content[:insertion_point] + new_code + '\n' + content[insertion_point:]
    with open('/app/main.py', 'w') as f:
        f.write(new_content)
    print('SUCCESS: Send endpoint added to main.py')
    print(f'New file size: {len(new_content)} chars')
