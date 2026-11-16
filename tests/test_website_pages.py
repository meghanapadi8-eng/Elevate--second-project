import os
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.in_title = False
        self.references = []
        self.page_links = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "script" and attributes.get("src"):
            self.references.append(attributes["src"])
        elif tag == "link" and "stylesheet" in attributes.get("rel", "").split():
            if attributes.get("href"):
                self.references.append(attributes["href"])
        elif tag == "a" and attributes.get("href"):
            self.page_links.append(attributes["href"])

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data.strip()


class WebsitePageSmokeTests(unittest.TestCase):
    def test_every_html_page_has_a_title_and_loads_local_assets(self):
        pages = sorted(ROOT.glob("*.html"))
        self.assertTrue(pages, "No website pages were found.")

        for page_path in pages:
            with self.subTest(page=page_path.name):
                parser = PageReferences()
                parser.feed(page_path.read_text(encoding="utf-8"))
                self.assertTrue(parser.title, "Page is missing a title.")

                for reference in parser.references:
                    self.assert_local_file(reference, "asset")

                for link in parser.page_links:
                    if urlsplit(link).path.lower().endswith(".html"):
                        self.assert_local_file(link, "page")

    def assert_local_file(self, reference, label):
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc:
            return
        relative_path = unquote(parsed.path)
        if not relative_path:
            return
        target = (ROOT / relative_path).resolve()
        self.assertEqual(
            os.path.commonpath((str(ROOT.resolve()), str(target))),
            str(ROOT.resolve()),
            f"{label.capitalize()} escapes the website folder: {reference}",
        )
        self.assertTrue(target.is_file(), f"Missing local {label}: {reference}")

    def test_frontend_no_longer_targets_php_api(self):
        frontend_files = list(ROOT.glob("*.js")) + list(ROOT.glob("*.html"))
        for file_path in frontend_files:
            with self.subTest(file=file_path.name):
                self.assertNotIn("api/index.php", file_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
