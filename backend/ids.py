"""UUIDv7 generation.

v7 (RFC 9562) is time-ordered: a 48-bit millisecond timestamp followed by
random bits. That gives non-guessable ids that still insert near-sequentially,
so B-tree index locality stays close to an integer PK (unlike random v4).

Vendored because `uuid.uuid7()` only exists in Python 3.14+; this works on 3.9
through 3.14 identically. Returns the canonical string form (stored as
String(36)).
"""
import secrets
import time
import uuid


def uuid7() -> str:
    unix_ts_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    rand_a = secrets.randbits(12)   # fills the rest of the high 64 bits
    rand_b = secrets.randbits(62)   # low 62 bits after the variant
    value = (
        (unix_ts_ms << 80)
        | (0x7 << 76)      # version 7
        | (rand_a << 64)
        | (0b10 << 62)     # variant 10
        | rand_b
    )
    return str(uuid.UUID(int=value))
