#!/usr/bin/env python3
"""CLI utility to create or seed an admin user with TOTP 2FA into the MantisVision database."""

import argparse
import bcrypt
import pyotp

def main():
    parser = argparse.ArgumentParser(description="Create MantisVision User with TOTP")
    parser.add_argument("--email", default="admin@company.internal", help="User company email")
    parser.add_argument("--password", default="AdminSecure2026!", help="Plaintext password")
    args = parser.parse_args()

    pwd_bytes = args.password.encode("utf-8")[:72]
    password_hash = bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")
    totp_secret = pyotp.random_base32()
    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=args.email,
        issuer_name="MantisVision"
    )

    print("\n" + "=" * 60)
    print("MantisVision User Credentials Created")
    print("=" * 60)
    print(f"Email:       {args.email}")
    print(f"Password:    {args.password}")
    print(f"TOTP Secret: {totp_secret}")
    print(f"OTPAuth URI: {totp_uri}")
    print("=" * 60)
    print("\nSQL Insert Command (run inside PostgreSQL or via docker exec):")
    print(f"""
INSERT INTO users (email, password_hash, totp_secret, totp_enabled)
VALUES ('{args.email}', '{password_hash}', '{totp_secret}', true)
ON CONFLICT (email) DO UPDATE 
SET password_hash = EXCLUDED.password_hash, totp_secret = EXCLUDED.totp_secret, totp_enabled = true;
    """.strip())
    print("\n" + "=" * 60 + "\n")

if __name__ == "__main__":
    main()
