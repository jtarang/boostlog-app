"""bootmod3 (Auth0) integration -- authenticate on a user's behalf and pull
their datalogs.

Flow mirrors auth0.js 9.x embedded login as used by the bootmod3 web app:
  1. POST /co/authenticate  (username+password) -> single-use login_ticket
  2. GET  /authorize        (login_ticket)      -> access_token + id_token

Token roles (they are NOT interchangeable):
  - id_token:     signed HS256 JWT, carries the profile/email/nonce claims.
  - access_token: encrypted JWE (dir/A256GCM), opaque to us. Auth0 /userinfo and
                  bootmod3's own API accept it -- the latter in a `jwt` header.
"""

from __future__ import annotations

import base64
import binascii
import json
import secrets
from urllib.parse import parse_qs, urlparse

import httpx

AUTH0_DOMAIN = "bootmod3.auth0.com"
CLIENT_ID = "jFCsF2RJexibT5RhbTCnQsD1E7htS9GT"
REDIRECT_URI = "https://www.bootmod3.net/www/index.html"
ORIGIN = "https://www.bootmod3.net"
API_BASE = "https://www.bootmod3.net"
REALM = "Username-Password-Authentication"
AUDIENCE = "https://bootmod3.auth0.com/userinfo"
SCOPE = "openid profile email"
APP_VERSION = "2.00.005"
# base64 of {"name":"angular-lock","version":"3.0.4","env":{"lock.js":"11.27.0","auth0.js":"9.14.0"}}
AUTH0_CLIENT = (
    "eyJuYW1lIjoiYW5ndWxhci1sb2NrIiwidmVyc2lvbiI6IjMuMC40Iiwi"
    "ZW52Ijp7ImxvY2suanMiOiIxMS4yNy4wIiwiYXV0aDAuanMiOiI5LjE0LjAifX0="
)

_DEFAULT_HEADERS = {
    "Origin": ORIGIN,
    "Referer": ORIGIN + "/",
    "Auth0-Client": AUTH0_CLIENT,
    "User-Agent": "Mozilla/5.0",
}


class Bootmod3Error(Exception):
    """Something went wrong talking to bootmod3/Auth0.

    `auth` marks errors caused by bad/expired credentials so callers can map
    them to 401 vs 502.
    """

    def __init__(self, message: str, *, auth: bool = False):
        super().__init__(message)
        self.auth = auth


def decode_jwt_payload(token: str) -> dict:
    """Base64url-decode a JWT payload (claims). Does NOT verify the signature."""
    try:
        payload_b64 = token.split(".")[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(padded))
    except (IndexError, ValueError, binascii.Error):
        return {}


async def authenticate(username: str, password: str, *, timeout: float = 30.0) -> dict:
    """Run the two-step login. Returns a token dict:
    {access_token, id_token, token_type, expires_in, exp, email}.

    Raises Bootmod3Error(auth=True) for bad credentials / MFA.
    """
    async with httpx.AsyncClient(
        headers=_DEFAULT_HEADERS, timeout=timeout, follow_redirects=False
    ) as client:
        # Step 1: credentials -> login_ticket (cookie is set on the client jar).
        resp = await client.post(
            f"https://{AUTH0_DOMAIN}/co/authenticate",
            json={
                "client_id": CLIENT_ID,
                "username": username,
                "password": password,
                "realm": REALM,
                "credential_type": "http://auth0.com/oauth/grant-type/password-realm",
            },
        )
        if resp.status_code == 401 or resp.status_code == 403:
            raise Bootmod3Error(_err_detail(resp, "invalid bootmod3 credentials"), auth=True)
        if resp.status_code != 200:
            raise Bootmod3Error(f"/co/authenticate failed ({resp.status_code}): {resp.text[:300]}")
        login_ticket = resp.json().get("login_ticket")
        if not login_ticket:
            raise Bootmod3Error(f"no login_ticket in response: {resp.text[:300]}", auth=True)

        # Step 2: silent /authorize with the ticket -> tokens in redirect fragment.
        state = secrets.token_urlsafe(24)
        nonce = secrets.token_urlsafe(24)
        resp = await client.get(
            f"https://{AUTH0_DOMAIN}/authorize",
            params={
                "client_id": CLIENT_ID,
                "response_type": "token id_token",
                "redirect_uri": REDIRECT_URI,
                "scope": SCOPE,
                "audience": AUDIENCE,
                "nonce": nonce,
                "state": state,
                "realm": REALM,
                "login_ticket": login_ticket,
                "response_mode": "fragment",
                "prompt": "none",
                "auth0Client": AUTH0_CLIENT,
            },
        )
        location = resp.headers.get("location", "")
        if resp.status_code not in (301, 302, 303, 307, 308) or not location:
            raise Bootmod3Error(
                f"/authorize did not redirect ({resp.status_code}): {location or resp.text[:300]}"
            )

        data = {k: v[0] for k, v in parse_qs(urlparse(location).fragment).items()}
        if "error" in data:
            raise Bootmod3Error(
                f"authorize error: {data.get('error')} - {data.get('error_description')}", auth=True
            )
        if data.get("state") != state:
            raise Bootmod3Error("state mismatch (stale/replayed authorize response)")
        if "access_token" not in data or "id_token" not in data:
            raise Bootmod3Error(f"tokens missing from authorize redirect: {location}")

        claims = decode_jwt_payload(data["id_token"])
        if claims.get("nonce") != nonce:
            raise Bootmod3Error("nonce mismatch between request and id_token")

        return {
            "access_token": data["access_token"],
            "id_token": data["id_token"],
            "token_type": data.get("token_type", "Bearer"),
            "expires_in": int(data.get("expires_in", 0) or 0),
            "exp": claims.get("exp"),  # epoch seconds; used to detect expiry
            "email": claims.get("email"),
        }


def _api_headers(tokens: dict) -> dict:
    """Headers bootmod3's own API expects: Bearer id_token + `jwt` access_token."""
    return {
        **_DEFAULT_HEADERS,
        "Authorization": f"Bearer {tokens['id_token']}",
        "jwt": tokens["access_token"],
        "client": "web",
        "appVersion": APP_VERSION,
        "appBuild": APP_VERSION,
        "Accept": "application/json, text/plain, */*",
    }


async def list_logs(tokens: dict, *, timeout: float = 30.0) -> list | dict:
    """GET /getlogs -> the account's datalog list (shape is bootmod3's; passed
    through with light normalization by the caller)."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(f"{API_BASE}/getlogs", headers=_api_headers(tokens))
    if resp.status_code in (401, 403):
        raise Bootmod3Error("bootmod3 rejected the token (re-link required)", auth=True)
    if resp.status_code != 200:
        raise Bootmod3Error(f"/getlogs failed ({resp.status_code}): {resp.text[:300]}")
    return resp.json()


async def download_log(tokens: dict, log_id: str, *, timeout: float = 60.0) -> bytes:
    """Download a single datalog's CSV by id, authenticated as the linked user.

    bootmod3 serves logs at /dlog?id=<id> (the same endpoint the public proxy
    uses); private logs additionally require the account's auth headers.
    """
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(
            f"{API_BASE}/dlog",
            params={"id": log_id},
            headers=_api_headers(tokens),
        )
    if resp.status_code in (401, 403):
        raise Bootmod3Error("bootmod3 rejected the token (re-link required)", auth=True)
    if resp.status_code == 404:
        raise Bootmod3Error(f"log {log_id} not found")
    if resp.status_code != 200:
        raise Bootmod3Error(f"/dlog failed ({resp.status_code}): {resp.text[:200]}")
    content_type = resp.headers.get("content-type", "")
    if "html" in content_type:
        raise Bootmod3Error("bootmod3 returned HTML -- log id may be invalid or not accessible")
    return resp.content


def _err_detail(resp: httpx.Response, fallback: str) -> str:
    try:
        body = resp.json()
        return body.get("error_description") or body.get("description") or body.get("error") or fallback
    except (ValueError, json.JSONDecodeError):
        return fallback
