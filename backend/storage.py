"""Log blob storage.

Files (the user CSV datalogs) live in S3 when LOG_BUCKET is set, otherwise on
local disk under UPLOAD_DIR. Metadata stays in the DB — this module only moves
bytes. Keeping local disk as the fallback means local dev and the test suite
work with no S3/AWS.

Readers that need a filesystem path (Polars) use `local_path()`, which yields
the real path locally and a temp download for S3 (removed on exit).
"""
import os
import shutil
import tempfile
from contextlib import contextmanager
from typing import Optional

from backend import config

_s3 = None


def _bucket() -> Optional[str]:
    return config.LOG_BUCKET or None


def _client():
    global _s3
    if _s3 is None:
        import boto3
        _s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1"))
    return _s3


def _key(name: str) -> str:
    return os.path.basename(name)


def _local(name: str) -> str:
    return os.path.join(config.UPLOAD_DIR, os.path.basename(name))


def save_fileobj(name: str, fileobj) -> None:
    if _bucket():
        _client().upload_fileobj(fileobj, _bucket(), _key(name))
    else:
        with open(_local(name), "wb") as f:
            shutil.copyfileobj(fileobj, f)


def save(name: str, data: bytes) -> None:
    if _bucket():
        _client().put_object(Bucket=_bucket(), Key=_key(name), Body=data)
    else:
        with open(_local(name), "wb") as f:
            f.write(data)


def read_bytes(name: str) -> bytes:
    if _bucket():
        return _client().get_object(Bucket=_bucket(), Key=_key(name))["Body"].read()
    with open(_local(name), "rb") as f:
        return f.read()


def exists(name: str) -> bool:
    if _bucket():
        from botocore.exceptions import ClientError
        try:
            _client().head_object(Bucket=_bucket(), Key=_key(name))
            return True
        except ClientError:
            return False
    return os.path.exists(_local(name))


def delete(name: str) -> None:
    # Best-effort; the DB row is the source of truth.
    if _bucket():
        from botocore.exceptions import ClientError
        try:
            _client().delete_object(Bucket=_bucket(), Key=_key(name))
        except ClientError:
            pass
    else:
        try:
            os.remove(_local(name))
        except OSError:
            pass


@contextmanager
def local_path(name: str):
    """Yield a readable local filesystem path for the blob (for Polars). S3
    objects are downloaded to a temp file that's removed on exit; local files are
    yielded in place."""
    if _bucket():
        fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(name)[1] or ".csv")
        os.close(fd)
        try:
            _client().download_file(_bucket(), _key(name), tmp)
            yield tmp
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
    else:
        yield _local(name)
