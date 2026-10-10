"""One-time setup for push notifications: generates a VAPID keypair.

Run once:  cd backend && python -m app.generate_vapid_keys
Then put the printed VAPID_PUBLIC_KEY line in your .env - the private key is
written straight to data/vapid_private.pem and never needs to leave the server.
"""
import base64

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid

from .config import settings, DATA_DIR


def main():
    v = Vapid()
    v.generate_keys()
    pub_raw = v.public_key.public_bytes(encoding=Encoding.X962, format=PublicFormat.UncompressedPoint)
    pub_b64 = base64.urlsafe_b64encode(pub_raw).decode().rstrip("=")

    path = DATA_DIR / "vapid_private.pem"
    path.write_text(v.private_pem().decode())

    print(f"Private key written to {path}")
    print("Add this to your .env:")
    print(f"VAPID_PUBLIC_KEY={pub_b64}")


if __name__ == "__main__":
    main()
