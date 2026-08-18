#!/usr/bin/env python3
"""Encrypt one content blob for Dror's Portal.

Usage: encrypt_blob.py <input file> <output .enc> <aad>
AAD convention: "<product>-<YYYY-MM-DD>", e.g. "news-2026-08-18" — binds the
blob to its product and date so a swapped or replayed file fails to decrypt.

Envelope (JSON): {v, alg, aad, wrapped_key, iv, ct} — all binary fields base64.
Scheme: fresh AES-256-GCM key per blob, wrapped with the site owner's
RSA-OAEP-4096 public key (SHA-256 for both OAEP and MGF1 — matches WebCrypto).
"""
import base64
import json
import os
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def encrypt(data: bytes, aad: str) -> dict:
    with open(os.path.join(ROOT, "public_key.pem"), "rb") as f:
        pub = serialization.load_pem_public_key(f.read())
    key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, data, aad.encode())
    wrapped = pub.encrypt(
        key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    return {"v": 1, "alg": "RSA-OAEP-256+A256GCM", "aad": aad, "wrapped_key": b64(wrapped), "iv": b64(iv), "ct": b64(ct)}


def main() -> None:
    src, dst, aad = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(src, "rb") as f:
        data = f.read()
    env = encrypt(data, aad)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(env, f)
    print(f"encrypted {src} -> {dst} ({len(data)} bytes plaintext, aad={aad})")


if __name__ == "__main__":
    main()
