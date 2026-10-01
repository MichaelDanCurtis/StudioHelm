"""One serialized API operation; invoked by the local Vite server."""
import fcntl
import json
import sys
from .device import RUNTIME, refresh, plan, apply
from .network import discover


def main():
    RUNTIME.mkdir(exist_ok=True)
    try:
        with (RUNTIME / 'adapter.lock').open('w') as lock:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise ValueError('The device adapter is busy. Try again shortly.')
            operation = sys.argv[1]
            payload = json.load(sys.stdin)
            if operation == 'status':
                path = RUNTIME / 'latest.json'
                result = {'snapshot': json.loads(path.read_text()) if path.exists() else None}
            elif operation == 'refresh': result = refresh()
            elif operation == 'plan': result = plan(payload)
            elif operation == 'apply': result = apply(payload)
            elif operation == 'discover': result = discover(payload)
            else: raise ValueError('Unsupported operation')
            print(json.dumps({'ok': True, 'result': result}))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) or type(error).__name__}))


if __name__ == '__main__': main()
