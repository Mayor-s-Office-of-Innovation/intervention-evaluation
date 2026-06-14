"""Tiny JSON GET helper. Stdlib only.

Python.org builds on macOS ship without system CA certs, so verified TLS fails. We try
a verified context first and fall back to an unverified one — acceptable here because every
request is a read-only GET against the public data.sfgov.org open-data portal (no secrets,
no writes, no auth).
"""
import json
import ssl
import urllib.error
import urllib.request

_UA = {"User-Agent": "sf-district-dashboard-build"}


def _is_cert_error(err):
    reason = getattr(err, "reason", err)
    return isinstance(reason, ssl.SSLError)


def get_json(url, timeout=120):
    req = urllib.request.Request(url, headers=_UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return json.load(r)
    except (urllib.error.URLError, ssl.SSLError) as e:
        if not _is_cert_error(e):
            raise
        # Python.org macOS build without system CAs → fall back to unverified (read-only public GET).
        with urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context()) as r:
            return json.load(r)
