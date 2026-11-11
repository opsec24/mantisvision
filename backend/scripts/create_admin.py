#!/usr/bin/env python3
"""CLI utility to create or seed an admin user with TOTP 2FA into the MantisVision database."""

import argparse
import os
import sys
import bcrypt
import pyotp

def insert_into_database(email: str, password_hash: str, totp_secret: str) -> bool:
    """Attempts to insert/update the user record directly into the database."""
    # 1. Try via psycopg2 if available
    db_url = os.environ.get("DATABASE_URL", "postgresql://mantis:securepass@postgres:5432/mantis_web")
    # Clean asyncpg prefix if present
    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
    
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (email, password_hash, totp_secret, totp_enabled)
                VALUES (%s, %s, %s, true)
                ON CONFLICT (email) DO UPDATE 
                SET password_hash = EXCLUDED.password_hash, totp_secret = EXCLUDED.totp_secret, totp_enabled = true;
            """, (email, password_hash, totp_secret))
            conn.commit()
        conn.close()
        return True
    except Exception as e:
        # Fall back to asyncpg if psycopg2 fails
        try:
            import asyncio
            import asyncpg
            async def _insert():
                clean_url = db_url.replace("postgresql://", "")
                user_pass, host_db = clean_url.split("@")
                user, password = user_pass.split(":")
                host_port, dbname = host_db.split("/")
                host = host_port.split(":")[0]
                port = int(host_port.split(":")[1]) if ":" in host_port else 5432
                c = await asyncpg.connect(user=user, password=password, database=dbname, host=host, port=port)
                await c.execute("""
                    INSERT INTO users (email, password_hash, totp_secret, totp_enabled)
                    VALUES ($1, $2, $3, true)
                    ON CONFLICT (email) DO UPDATE 
                    SET password_hash = EXCLUDED.password_hash, totp_secret = EXCLUDED.totp_secret, totp_enabled = true;
                """, email, password_hash, totp_secret)
                await c.close()
            asyncio.run(_insert())
            return True
        except Exception:
            return False

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

    db_updated = insert_into_database(args.email, password_hash, totp_secret)

    print("\n" + "=" * 60)
    print(" MantisVision User Credentials Provisioned")
    print("=" * 60)
    print(f" Email:       {args.email}")
    print(f" Password:    {args.password}")
    print(f" TOTP Secret: {totp_secret}")
    print(f" OTPAuth URI: {totp_uri}")
    if db_updated:
        print(" Database:    Successfully saved to PostgreSQL!")
    else:
        print(" Database:    Direct DB connection unavailable (run manual SQL below)")
    print("=" * 60)
    
    if not db_updated:
        print("\nManual SQL Insert Command:")
        print(f"""
INSERT INTO users (email, password_hash, totp_secret, totp_enabled)
VALUES ('{args.email}', '{password_hash}', '{totp_secret}', true)
ON CONFLICT (email) DO UPDATE 
SET password_hash = EXCLUDED.password_hash, totp_secret = EXCLUDED.totp_secret, totp_enabled = true;
        """.strip())
        print("\n" + "=" * 60 + "\n")

if __name__ == "__main__":
    main()
