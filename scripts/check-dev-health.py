#!/usr/bin/env python3
"""Read-only dev smoke check, bypassing inherited HTTP proxies."""
import argparse
import json
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import ProxyHandler, Request, build_opener


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        url = attrs.get("src") if tag == "script" else attrs.get("href") if tag == "link" else None
        if url and urlsplit(url).path.startswith("/_next/") and urlsplit(url).path.endswith((".js", ".css")):
            self.urls.add(url)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://pi-dev.tr0.cc/")
    args = parser.parse_args()
    base = args.base_url.rstrip("/") + "/"
    opener = build_opener(ProxyHandler({}))

    def read(path):
        url = urljoin(base, path)
        assert urlsplit(url).netloc == urlsplit(base).netloc, "Unexpected external asset"
        with opener.open(Request(url, headers={"Cache-Control": "no-cache"}), timeout=45) as response:
            assert response.status == 200, f"{url}: HTTP {response.status}"
            body = response.read()
            assert body, f"{url}: empty response"
            return body

    html = read("/").decode("utf-8")
    assert "<html" in html and "</html>" in html, "Invalid homepage HTML"
    print("PASS homepage HTTP 200")
    home = json.loads(read("/api/home"))
    assert isinstance(home.get("home"), str) and home["home"], "Invalid API response"
    print("PASS /api/home HTTP 200 + JSON")
    manifest = json.loads(read("/manifest.webmanifest"))
    assert manifest.get("name") and manifest.get("icons"), "Invalid manifest"
    for icon in manifest["icons"]:
        read(icon["src"])
    print("PASS manifest + application icons")
    assets = Assets()
    assets.feed(html)
    assert assets.urls, "No application JS/CSS found"
    for url in sorted(assets.urls):
        read(url)
    print(f"PASS {len(assets.urls)} JS/CSS resources HTTP 200")


if __name__ == "__main__":
    main()
