"""Storage layer: S3 backend (via moto) round-trips. The local-disk fallback is
exercised implicitly by the rest of the suite (no LOG_BUCKET set)."""
import io

import boto3

from backend import config, storage


def _use_bucket(monkeypatch, name):
    boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=name)
    monkeypatch.setattr(config, "LOG_BUCKET", name)
    storage._s3 = None  # force a fresh (moto-backed) client


def test_s3_roundtrip(monkeypatch):
    _use_bucket(monkeypatch, "test-logs-roundtrip")
    name = "1_abc_test.csv"

    storage.save(name, b"a,b\n1,2\n")
    assert storage.exists(name)
    assert storage.read_bytes(name) == b"a,b\n1,2\n"

    with storage.local_path(name) as p:
        with open(p, "rb") as f:
            assert f.read() == b"a,b\n1,2\n"

    storage.delete(name)
    assert not storage.exists(name)


def test_s3_save_fileobj(monkeypatch):
    _use_bucket(monkeypatch, "test-logs-fileobj")
    storage.save_fileobj("f.csv", io.BytesIO(b"x,y\n3,4\n"))
    assert storage.read_bytes("f.csv") == b"x,y\n3,4\n"


def test_missing_object(monkeypatch):
    _use_bucket(monkeypatch, "test-logs-missing")
    assert storage.exists("nope.csv") is False
