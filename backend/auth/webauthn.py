import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from backend import config
from backend.auth.core import create_access_token, get_current_user
from backend.db import get_db
from backend.models import User, UserCredential
from backend.schemas import PasskeyRename

router = APIRouter()

# Temporary store for WebAuthn challenges
# In production, use Redis or a DB table with ttl
webauthn_challenges: dict = {}


def _webauthn_params(request: Request) -> tuple[str, str]:
    # Behind a Cloudflare tunnel, host/scheme arrive via X-Forwarded-* headers.
    import os

    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto")
    host_header = forwarded_host or request.headers.get("host", "")
    scheme = forwarded_proto or request.url.scheme

    hostname = host_header.split(":", 1)[0]
    rp_id = os.getenv("RP_ID") or hostname or "localhost"

    origin = os.getenv("WP_ORIGIN")
    if not origin:
        if host_header:
            origin = f"{scheme}://{host_header}"
        else:
            origin = f"http://{rp_id}:8000" if rp_id == "localhost" else f"https://{rp_id}"

    return rp_id, origin


def _credential_descriptor(c: "UserCredential") -> PublicKeyCredentialDescriptor:
    transports = []
    if c.transports:
        for t in json.loads(c.transports):
            try:
                transports.append(AuthenticatorTransport(t))
            except ValueError:
                continue
    return PublicKeyCredentialDescriptor(
        id=base64url_to_bytes(c.credential_id),
        transports=transports or None,
    )


@router.get("/api/auth/webauthn/register/options")
def webauthn_register_options(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.webauthn_id:
        current_user.webauthn_id = str(uuid.uuid4())
        db.commit()

    rp_id, _ = _webauthn_params(request)

    existing_credentials = []
    for c in current_user.credentials:
        try:
            existing_credentials.append(_credential_descriptor(c))
        except Exception as e:
            print(f"WARN: Skipping unreadable credential {c.id} for user {current_user.username}: {e}")
            continue

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=config.RP_NAME,
        user_id=current_user.webauthn_id.encode("utf-8"),
        user_name=current_user.username,
        user_display_name=current_user.full_name or current_user.username,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=None,
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=existing_credentials,
    )
    print(f"DEBUG: Generated registration options for {current_user.username}")

    webauthn_challenges[f"reg_{current_user.id}"] = options.challenge
    return json.loads(options_to_json(options))


@router.post("/api/auth/webauthn/register/verify")
async def webauthn_register_verify(request: Request, payload: dict, name: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    challenge = webauthn_challenges.pop(f"reg_{current_user.id}", None)
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge missing or expired")

    try:
        rp_id, origin = _webauthn_params(request)

        print(f"DEBUG: Verifying registration for {current_user.username} (RP_ID: {rp_id}, Origin: {origin})")

        verification = verify_registration_response(
            credential=payload,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=rp_id,
        )
    except Exception as e:
        print(f"ERROR: Registration verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    cred_id_str = bytes_to_base64url(verification.credential_id)

    cred_name = (name or "").strip() or f"Passkey {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

    new_cred = UserCredential(
        user_id=current_user.id,
        credential_id=cred_id_str,
        public_key=base64.b64encode(verification.credential_public_key).decode("utf-8"),
        sign_count=verification.sign_count,
        transports=json.dumps(payload.get("response", {}).get("transports", [])),
        name=cred_name,
    )

    db.add(new_cred)
    db.commit()
    print(f"DEBUG: Successfully registered passkey for {current_user.username}")
    return {"status": "success", "message": "Passkey registered"}


@router.get("/api/auth/webauthn/login/options")
def webauthn_login_options(request: Request, username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing_credentials = []
    for c in user.credentials:
        try:
            existing_credentials.append(_credential_descriptor(c))
        except Exception as e:
            print(f"ERROR: Failed to parse credential {c.id} for user {username}: {e}")
            continue

    if not existing_credentials:
        print(f"DEBUG: No valid passkeys found for user {username}")
        raise HTTPException(status_code=400, detail="No passkeys registered for this user")

    try:
        rp_id, _ = _webauthn_params(request)
        options = generate_authentication_options(
            rp_id=rp_id,
            allow_credentials=existing_credentials,
            user_verification=UserVerificationRequirement.PREFERRED,
        )

        webauthn_challenges[f"login_{username}"] = options.challenge
        return json.loads(options_to_json(options))
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/auth/webauthn/login/verify")
async def webauthn_login_verify(request: Request, payload: dict, username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    challenge = webauthn_challenges.pop(f"login_{username}", None)
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge missing or expired")

    cred_id = payload.get("id")
    db_cred = db.query(UserCredential).filter(UserCredential.credential_id == cred_id).first()
    if not db_cred or db_cred.user_id != user.id:
        raise HTTPException(status_code=400, detail="Credential not found")

    try:
        rp_id, origin = _webauthn_params(request)

        verification = verify_authentication_response(
            credential=payload,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=rp_id,
            credential_public_key=base64.b64decode(db_cred.public_key),
            credential_current_sign_count=db_cred.sign_count,
        )

    except Exception as e:
        print(f"ERROR: Login verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    db_cred.sign_count = verification.new_sign_count
    db.commit()

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}


# --- DISCOVERABLE-CREDENTIAL (USERNAMELESS / AUTOFILL) LOGIN ---

@router.get("/api/auth/webauthn/login/discoverable/options")
def webauthn_login_discoverable_options(request: Request):
    rp_id, _ = _webauthn_params(request)
    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    challenge_key = bytes_to_base64url(options.challenge)
    webauthn_challenges[f"disc_{challenge_key}"] = options.challenge
    return json.loads(options_to_json(options))


@router.post("/api/auth/webauthn/login/discoverable/verify")
async def webauthn_login_discoverable_verify(request: Request, payload: dict, db: Session = Depends(get_db)):
    response = payload.get("response", {}) or {}
    client_data_b64 = response.get("clientDataJSON")
    if not client_data_b64:
        raise HTTPException(status_code=400, detail="Missing clientDataJSON")

    try:
        client_data = json.loads(base64url_to_bytes(client_data_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid clientDataJSON")

    challenge_key = client_data.get("challenge")
    challenge = webauthn_challenges.pop(f"disc_{challenge_key}", None) if challenge_key else None
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge missing or expired")

    cred_id = payload.get("id")
    db_cred = db.query(UserCredential).filter(UserCredential.credential_id == cred_id).first()
    if not db_cred:
        raise HTTPException(status_code=400, detail="Credential not found")

    user = db.query(User).filter(User.id == db_cred.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user_handle_b64 = response.get("userHandle")
    if user_handle_b64:
        try:
            user_handle = base64url_to_bytes(user_handle_b64).decode("utf-8")
        except Exception:
            user_handle = None
        if user_handle and user.webauthn_id and user_handle != user.webauthn_id:
            raise HTTPException(status_code=400, detail="User handle mismatch")

    try:
        rp_id, origin = _webauthn_params(request)

        verification = verify_authentication_response(
            credential=payload,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=rp_id,
            credential_public_key=base64.b64decode(db_cred.public_key),
            credential_current_sign_count=db_cred.sign_count,
        )
    except Exception as e:
        print(f"ERROR: Discoverable login verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    db_cred.sign_count = verification.new_sign_count
    db.commit()

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/api/auth/passkeys")
def list_passkeys(current_user: User = Depends(get_current_user)):
    return [
        {
            "id": c.id,
            "name": c.name or f"Passkey #{c.id}",
            "transports": json.loads(c.transports) if c.transports else [],
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in current_user.credentials
    ]


@router.delete("/api/auth/passkeys/{cred_id}")
def delete_passkey(cred_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cred = db.query(UserCredential).filter(
        UserCredential.id == cred_id,
        UserCredential.user_id == current_user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey not found")
    db.delete(cred)
    db.commit()
    return {"status": "success"}


@router.patch("/api/auth/passkeys/{cred_id}")
def rename_passkey(cred_id: int, payload: PasskeyRename, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_name = payload.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    cred = db.query(UserCredential).filter(
        UserCredential.id == cred_id,
        UserCredential.user_id == current_user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey not found")
    cred.name = new_name
    db.commit()
    return {"status": "success", "name": cred.name}
