"""Run inside API container; read password from stdin, store only Argon2 hash."""
import sys
from sqlalchemy.orm import Session
from .main import Base, engine, passwords
from .admin import Admin

def main():
    username=sys.argv[1].lower()
    password=sys.stdin.readline().rstrip('\r\n')
    if not (3<=len(username)<=32 and username.replace('_','').isalnum() and 8<=len(password)<=128):
        raise SystemExit('Invalid administrator input')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        if session.get(Admin,username): raise SystemExit('Administrator already exists; unchanged')
        session.add(Admin(username=username,password_hash=passwords.hash(password)));session.commit()
    print('Administrator created')

if __name__=='__main__': main()
