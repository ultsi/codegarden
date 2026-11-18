"""Static file server + __delay?ms=N (used by ?shot=N headless screenshots).
Usage: devserver.py <root> [port]"""
import http.server, functools, time, urllib.parse, sys
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.endswith('/__delay'):
            ms = int(urllib.parse.parse_qs(u.query).get('ms', ['3000'])[0])
            time.sleep(ms / 1000)
            self.send_response(204); self.end_headers(); return
        return super().do_GET()
    def log_message(self, *a): pass
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8137
print(f'serving {sys.argv[1]} at http://127.0.0.1:{port}/', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=sys.argv[1])).serve_forever()
