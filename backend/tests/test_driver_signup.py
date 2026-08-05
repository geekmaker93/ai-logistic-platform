from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from main import (
    SignupEmailVerificationModel,
    app,
    get_session,
    hash_password,
    utc_now,
)


client = TestClient(app)


def test_driver_signup_accepts_driver_role_and_creates_account() -> None:
    email = f"alex.driver+{uuid4().hex[:8]}@example.com"

    with get_session() as db:
        record = db.scalar(
            db.query(SignupEmailVerificationModel).filter(
                SignupEmailVerificationModel.email == email,
                SignupEmailVerificationModel.role == "driver",
            )
        )
        if record is None:
            record = SignupEmailVerificationModel(
                id=str(uuid4()),
                email=email,
                role="driver",
                code_hash=hash_password("123456"),
                expires_at=utc_now() + timedelta(minutes=10),
                created_at=utc_now(),
            )
            db.add(record)
        else:
            record.code_hash = hash_password("123456")
            record.expires_at = utc_now() + timedelta(minutes=10)
            record.created_at = utc_now()
        db.commit()

    response = client.post(
        "/auth/signup",
        json={
            "full_name": "Alex Driver",
            "company_name": "Alex Driver LLC",
            "email": email,
            "password": "Password123",
            "email_verification_code": "123456",
            "role": "driver",
            "id_document_name": "driver-license.pdf",
            "id_document_mime_type": "application/pdf",
            "id_document_base64": "dGVzdC1kb2N1bWVudA==",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "driver"
    assert payload["email"] == email
