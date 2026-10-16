"""`saga-reset-password`: set a new password for the owner, on the computer that runs Saga OS.

There is no email reset (Saga OS runs on your own machine and sends no mail), so whoever can run commands where the
data lives can reset it. Signs out every browser session of that account.
"""
from __future__ import annotations

import getpass
import sys

from sqlalchemy import delete, select

from . import company as C
from .db import init_db, session_scope
from .models import AuthToken, User
from .security import hash_password


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    init_db()
    with session_scope(C.MAIN) as db:
        users = list(db.scalars(select(User)))
        if not users:
            print("No account yet: open Saga OS in your browser to create one.")
            return 1
        email = args[0] if args else (users[0].email if len(users) == 1 else input("Email: ").strip())
        u = next((x for x in users if x.email.lower() == email.lower()), None)
        if not u:
            print(f"No account with the email {email}.")
            return 1
        pw = getpass.getpass(f"New password for {u.email} (at least 10 characters): ")
        if len(pw) < 10:
            print("Too short: use at least 10 characters.")
            return 1
        if getpass.getpass("Again: ") != pw:
            print("The two passwords are different.")
            return 1
        u.password_hash = hash_password(pw)
        db.execute(delete(AuthToken).where(AuthToken.user_id == u.id, AuthToken.kind == "session"))
    print(f"Done. Sign in as {u.email} with the new password.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
