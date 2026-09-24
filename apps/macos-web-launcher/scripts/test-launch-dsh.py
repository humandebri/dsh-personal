"""Exercise the launcher against a disposable HTTP server, without opening UI."""
import http.server
import os
from pathlib import Path
import subprocess
import tempfile
import sys
import time
import threading
import unittest

SCRIPT = Path(__file__).with_name('launch-dsh.sh').resolve()

def launcher_command():
    native = os.environ.get('DSH_NATIVE_LAUNCHER')
    return [native] if native else (['bash', '-c', 'exec 3>&1; exec 1>/dev/null; exec bash "$1" --app', 'DSH', str(SCRIPT)] if os.environ.get('DSH_TEST_APP_MODE') else ['bash', str(SCRIPT)])

class LauncherTests(unittest.TestCase):
    def test_new_server_waits_for_current_token(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            fake = folder / 'dsh'
            fake.write_text('#!' + sys.executable + '\n' + """
import http.server, os, threading, time
from pathlib import Path
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(303 if self.path == '/?token=current' else 401)
        if self.path == '/?token=current':
            self.send_header('Location', '/')
            self.send_header('Set-Cookie', 'session=valid')
        self.end_headers()
server = http.server.HTTPServer(('127.0.0.1', int(os.environ['DSH_WEB_PORT'])), Handler)
Path(os.environ['DSH_LOG_DIR'], 'pid').write_text(str(os.getpid()))
Path(os.environ['DSH_LOG_DIR'], 'path').write_text(os.environ.get('PATH', ''))
threading.Thread(target=server.serve_forever, daemon=True).start()
time.sleep(2)
print('dsh web: http://127.0.0.1:' + os.environ['DSH_WEB_PORT'] + '/?token=current', flush=True)
time.sleep(20)
""")
            fake.chmod(0o700)
            # Reserve an available port, then release it for the fake DSH process.
            probe = http.server.HTTPServer(('127.0.0.1', 0), http.server.BaseHTTPRequestHandler)
            port = probe.server_port
            probe.server_close()
            root = f'http://127.0.0.1:{port}/'
            (folder / 'dsh-web-url.txt').write_text(root + '?token=old')
            (folder / 'dsh-web.log').write_text(root + '?token=old\n')
            opener = folder / 'open'
            opener.write_text('#!/bin/bash\nprintf "%s" "$1" > "' + str(folder / 'opened') + '"\n')
            opener.chmod(0o700)
            try:
                result = subprocess.run(launcher_command(), env={**os.environ,
                    'DSH_BIN': str(fake), 'DSH_WEB_PORT': str(port), 'DSH_LOG_DIR': directory,
                    'DSH_OPEN_BIN': str(opener), 'DSH_DIALOG_BIN': '/usr/bin/false',
                    'DSH_LAUNCH_SHELL': '', 'DSH_WAIT_SECONDS': '10'}, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                if os.environ.get('DSH_TEST_APP_MODE'):
                    self.assertEqual(result.stdout.strip(), 'ready\t' + root + '?token=current')
                    self.assertNotIn('token=current', (folder / 'dsh-web.log').read_text())
                else:
                    self.assertEqual((folder / 'opened').read_text(), root + '?token=current')
                self.assertEqual((folder / 'dsh-web-url.txt').read_text().strip(), root + '?token=current')
                self.assertEqual((folder / 'dsh-web-url.txt').stat().st_mode & 0o777, 0o600)
                self.assertIn(str(Path.home() / '.local/bin'), (folder / 'path').read_text())
            finally:
                if (folder / 'pid').exists(): os.kill(int((folder / 'pid').read_text()), 15)

    def test_server_path_comes_from_login_shell(self):
        """A launch without the login PATH must recover it, ignoring shell chatter."""
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            marker = folder / 'marker-bin'
            marker.mkdir()
            login = folder / 'zsh'
            login.write_text('#!/bin/bash\nprintf "mise: harmless noise\\n"\n'
                             'printf "DSH_PATH=%s\\n" "/opt/homebrew/bin:/usr/bin:/bin:' + str(marker) + '"\n')
            login.chmod(0o700)
            fake = folder / 'dsh'
            fake.write_text('#!' + sys.executable + '\n' + """
import http.server, os, threading, time
from pathlib import Path
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(303 if self.path == '/?token=current' else 401)
        if self.path == '/?token=current':
            self.send_header('Location', '/')
            self.send_header('Set-Cookie', 'session=valid')
        self.end_headers()
server = http.server.HTTPServer(('127.0.0.1', int(os.environ['DSH_WEB_PORT'])), Handler)
Path(os.environ['DSH_LOG_DIR'], 'pid').write_text(str(os.getpid()))
Path(os.environ['DSH_LOG_DIR'], 'path').write_text(os.environ.get('PATH', ''))
threading.Thread(target=server.serve_forever, daemon=True).start()
time.sleep(2)
print('dsh web: http://127.0.0.1:' + os.environ['DSH_WEB_PORT'] + '/?token=current', flush=True)
time.sleep(20)
""")
            fake.chmod(0o700)
            probe = http.server.HTTPServer(('127.0.0.1', 0), http.server.BaseHTTPRequestHandler)
            port = probe.server_port
            probe.server_close()
            opener = folder / 'open'
            opener.write_text('#!/bin/bash\nexit 0\n')
            opener.chmod(0o700)
            try:
                result = subprocess.run(launcher_command(), env={**os.environ,
                    'DSH_BIN': str(fake), 'DSH_WEB_PORT': str(port), 'DSH_LOG_DIR': directory,
                    'DSH_OPEN_BIN': str(opener), 'DSH_DIALOG_BIN': '/usr/bin/false',
                    'DSH_LAUNCH_SHELL': str(login), 'DSH_WAIT_SECONDS': '10'},
                    capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(str(marker), (folder / 'path').read_text())
            finally:
                if (folder / 'pid').exists(): os.kill(int((folder / 'pid').read_text()), 15)

    def test_existing_server_credentials(self):
        for case in ('valid', 'expired', 'missing', 'foreign', 'public', 'error', 'disconnected'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                requests = []
                class Handler(http.server.BaseHTTPRequestHandler):
                    def log_message(self, *args): pass
                    def do_GET(self):
                        requests.append((self.path, self.headers.get('Cookie')))
                        if case == 'disconnected':
                            self.close_connection = True
                            return
                        if case == 'public':
                            self.send_response(200)
                        elif case == 'error':
                            self.send_response(500)
                        elif self.path == '/?token=valid':
                            self.send_response(303)
                            self.send_header('Location', '/')
                            self.send_header('Set-Cookie', 'session=valid; HttpOnly')
                        else:
                            self.send_response(401)
                        self.end_headers()
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    port = server.server_port
                    root = f'http://127.0.0.1:{port}/'
                    if case != 'missing':
                        candidate = 'http://example.invalid/?token=valid' if case == 'foreign' else root + '?token=' + ('expired' if case == 'expired' else 'valid')
                        (folder / 'dsh-web-url.txt').write_text(candidate)
                    opened = folder / 'opened'
                    dialog = folder / 'dialog'
                    for name, target in [('open', opened), ('alert', dialog)]:
                        executable = folder / name
                        executable.write_text('#!/bin/bash\nprintf "%s\\n" "$@" >> "' + str(target) + '"\n')
                        executable.chmod(0o700)
                    result = subprocess.run(launcher_command(), env={**os.environ,
                        'DSH_WEB_PORT': str(port), 'DSH_LOG_DIR': directory,
                        'DSH_BIN': '/usr/bin/true' if os.environ.get('DSH_NATIVE_LAUNCHER') else '/nonexistent', 'DSH_OPEN_BIN': str(folder / 'open'),
                        'DSH_DIALOG_BIN': str(folder / 'alert')}, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 1 if case == 'disconnected' else 0, result.stderr)
                    self.assertNotIn('token=', result.stderr)
                    if os.environ.get('DSH_TEST_APP_MODE'):
                        expected = 'error' if case in ('error', 'disconnected') else 'ready\t' + root + ('?token=valid' if case == 'valid' else '')
                        self.assertEqual(result.stdout.strip(), expected)
                        self.assertFalse(opened.exists())
                        self.assertFalse(dialog.exists())
                        self.assertTrue(thread.is_alive())
                        continue
                    self.assertNotIn('token=', result.stdout)
                    self.assertTrue(all(cookie is None for _, cookie in requests))
                    if case == 'valid':
                        self.assertEqual(opened.read_text().strip(), root + '?token=valid')
                        self.assertFalse(dialog.exists())
                    elif case == 'public':
                        self.assertEqual(opened.read_text().strip(), root)
                    elif case == 'error':
                        self.assertFalse(opened.exists())
                        self.assertIn('HTTP 500', dialog.read_text())
                    elif case == 'disconnected':
                        self.assertFalse(opened.exists())
                    else:
                        self.assertIn('認証 URL', dialog.read_text())
                        self.assertEqual(opened.read_text().strip(), root)
                    if case in ('missing', 'foreign'):
                        self.assertEqual(len(requests), 1)
                    self.assertTrue(thread.is_alive(), 'Existing server must not be stopped')
                finally:
                    server.shutdown()
                    server.server_close()

if __name__ == '__main__': unittest.main()
