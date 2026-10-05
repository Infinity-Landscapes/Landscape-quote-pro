#!/usr/bin/env python3
"""Builds the own-website version of the app (public/) from the same app.html the
claude.ai artifact is published from, so both always run identical app code."""
import json, os, re, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_APP = os.path.join(os.path.dirname(ROOT), "app", "app.html")
PUB = os.path.join(ROOT, "public")
SDK = os.path.join(ROOT, "node_modules", "firebase")

CONFIG = {
    "apiKey": "AIzaSyAaZFqO7-ka5VjtVj9dGqsq-uhdNViNhzg",
    "authDomain": "landscape-quote-pro.firebaseapp.com",
    "projectId": "landscape-quote-pro",
    "storageBucket": "landscape-quote-pro.firebasestorage.app",
    "messagingSenderId": "572546781213",
    "appId": "1:572546781213:web:3f3cf8a3869b8f1b2776f4",
}

GATE_CSS = """
#authGate{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:16px;
  background:#f2f8ea;font-family:Manrope,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2a12;}
@media (prefers-color-scheme: dark){#authGate{background:#111a0b;color:#e8f0df;}}
#authGate .ag-box{width:100%;max-width:400px;background:#fff;border-radius:16px;padding:26px 22px;box-shadow:0 8px 30px rgba(0,0,0,.08);}
@media (prefers-color-scheme: dark){#authGate .ag-box{background:#1b2613;}}
#authGate .ag-brand{font-family:Poppins,system-ui,sans-serif;font-weight:700;color:#56822b;margin-bottom:14px;font-size:15px;}
@media (prefers-color-scheme: dark){#authGate .ag-brand{color:#b7dd8a;}}
#authGate h1{font-family:Poppins,system-ui,sans-serif;font-size:22px;margin:0 0 4px;}
#authGate .ag-sub{margin:0 0 16px;opacity:.75;font-size:14px;}
#authGate label{display:block;font-weight:700;font-size:13px;margin:0 0 12px;}
#authGate input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:11px 12px;font-size:16px;border:1px solid #c9d6bb;border-radius:10px;background:transparent;color:inherit;}
#authGate .ag-btn{width:100%;padding:12px;border:0;border-radius:10px;background:#56822b;color:#fff;font-weight:800;font-size:15px;cursor:pointer;margin-top:4px;}
#authGate .ag-btn[disabled]{opacity:.6;cursor:default;}
#authGate .ag-links{display:flex;flex-direction:column;gap:8px;margin-top:14px;font-size:14px;text-align:center;}
#authGate .ag-links a{color:#56822b;}
@media (prefers-color-scheme: dark){#authGate .ag-links a{color:#b7dd8a;}}
#authGate .ag-msg{padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:12px;}
#authGate .ag-msg.err{background:#fde8e8;color:#9b1c1c;}
#authGate .ag-msg.ok{background:#e2f0d3;color:#3f611f;}
"""

def main():
    app = open(SRC_APP, encoding="utf-8").read()
    app = re.sub(r"^\s*<title>.*?</title>\s*", "", app, count=1, flags=re.S)
    os.makedirs(os.path.join(PUB, "sdk"), exist_ok=True)
    for f in ("firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"):
        shutil.copy(os.path.join(SDK, f), os.path.join(PUB, "sdk", f))
    shutil.copy(os.path.join(ROOT, "src", "platform.js"), os.path.join(PUB, "platform.js"))
    html = (
        "<!doctype html>\n<html lang=\"en-GB\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
        "<title>Infinity Landscape Quote Pro</title>\n"
        "<style>html,body{margin:0;padding:0;}" + GATE_CSS + "</style>\n"
        "<script>window.__FIREBASE_CONFIG__ = " + json.dumps(CONFIG) + ";</script>\n"
        "<script src=\"/sdk/firebase-app-compat.js\"></script>\n"
        "<script src=\"/sdk/firebase-auth-compat.js\"></script>\n"
        "<script src=\"/sdk/firebase-firestore-compat.js\"></script>\n"
        "<script src=\"/platform.js\"></script>\n"
        "</head>\n<body>\n" + app + "\n</body>\n</html>\n"
    )
    open(os.path.join(PUB, "index.html"), "w", encoding="utf-8").write(html)
    print("built", os.path.join(PUB, "index.html"), len(html), "bytes")

if __name__ == "__main__":
    main()
