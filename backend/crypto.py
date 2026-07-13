"""Symmetric encryption for secrets we must be able to read back (e.g. linked
third-party tokens). Unlike user passwords -- which are one-way bcrypt hashes --
these need to be decryptable so we can replay them to the upstream service.

The Fernet key is derived from SECRET_KEY so no extra secret has to be managed;
set BOOTMOD3_ENC_KEY (a urlsafe base64 32-byte key) to rotate independently.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from backend.config import SECRET_KEY


def _fernet() -> Fernet:
    override = os.getenv("BOOTMOD3_ENC_KEY")
    if override:
        return Fernet(override.encode())
    # Derive a stable 32-byte key from SECRET_KEY.
    digest = hashlib.sha256(SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def try_decrypt(token: str | None) -> str | None:
    """Decrypt, returning None if the value is missing or can't be read
    (e.g. SECRET_KEY rotated). Callers treat None as 'not linked'."""
    if not token:
        return None
    try:
        return decrypt(token)
    except (InvalidToken, ValueError):
        return None
