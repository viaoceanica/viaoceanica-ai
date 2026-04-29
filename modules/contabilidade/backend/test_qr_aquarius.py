from app.processing import _extract_qr_payload_from_pdf, parse_portuguese_qr_payload

PDF_PATH = "/tmp/aquarius-fatura.pdf"

with open(PDF_PATH, "rb") as f:
    raw = f.read()

payload = _extract_qr_payload_from_pdf(raw)
parsed = parse_portuguese_qr_payload(payload)

print("PAYLOAD:")
print(repr(payload))
print("PARSED:")
print(parsed)
