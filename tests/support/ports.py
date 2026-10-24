"""Hold distinct loopback ports while dependent fixture processes start."""
import socket
from contextlib import contextmanager,ExitStack


@contextmanager
def reserved_loopback_ports(count):
    with ExitStack() as stack:
        reservations=[]
        for _ in range(count):
            held=stack.enter_context(socket.socket(socket.AF_INET,socket.SOCK_STREAM))
            if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):
                held.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
            held.bind(('127.0.0.1',0));reservations.append(held)
        yield reservations
