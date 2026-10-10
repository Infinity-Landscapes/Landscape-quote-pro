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

# Website payments (Stripe) switch on once the payment functions are deployed and set up.
WEB_BILLING = os.environ.get("WEB_BILLING", "0") == "1"

CSS_FILE = os.path.join(ROOT, "src", "platform.css")

def main():
    app = open(SRC_APP, encoding="utf-8").read()
    app = re.sub(r"^\s*<title>.*?</title>\s*", "", app, count=1, flags=re.S)
    os.makedirs(os.path.join(PUB, "sdk"), exist_ok=True)
    for f in ("firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"):
        shutil.copy(os.path.join(SDK, f), os.path.join(PUB, "sdk", f))
    shutil.copy(os.path.join(ROOT, "src", "platform.js"), os.path.join(PUB, "platform.js"))
    for f in os.listdir(os.path.join(ROOT, "src", "legal")):
        shutil.copy(os.path.join(ROOT, "src", "legal", f), os.path.join(PUB, f))
    # Public front page (/home) and its images.
    site = os.path.join(ROOT, "src", "site")
    if os.path.isdir(site):
        shutil.copytree(site, PUB, dirs_exist_ok=True)
    html = (
        "<!doctype html>\n<html lang=\"en-GB\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
        "<title>Infinity Landscape Quote Pro</title>\n"
        "<style>html,body{margin:0;padding:0;}\n" + open(CSS_FILE, encoding="utf-8").read() + "</style>\n"
        "<script>window.__FIREBASE_CONFIG__ = " + json.dumps(CONFIG) + ";window.__WEB_BILLING__ = " + ("true" if WEB_BILLING else "false") + ";</script>\n"
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
