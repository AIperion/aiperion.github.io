#!/usr/bin/env python3
"""Regression checks against Jekyll's output, using only the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import unquote, urljoin, urlsplit


REPO = Path(__file__).resolve().parents[1]
ROUTES = {"/": "en", "/de/": "de", "/projects/": "en", "/de/projects/": "de"}
HOMES = {"/": "en", "/de/": "de"}
PROJECTS = {"/projects/": "en", "/de/projects/": "de"}
HOME_FOR = {"en": "/", "de": "/de/"}
PROJECT_FOR = {"en": "/projects/", "de": "/de/projects/"}
SECTIONS = ["hero", "services", "work", "approach", "tech", "about", "contact"]
LINKEDIN = "https://www.linkedin.com/in/christophh01"
MEDIUM = "https://medium.com/@hoffe86"
PROJECT = "https://github.com/hoffe86/agile-agents"
MS_PROFILE = "https://learn.microsoft.com/en-us/users/hoffe/credentials/certifications"
CREDENTIALS = {
    "Microsoft Certified: Azure Developer Associate":
        "https://learn.microsoft.com/en-us/users/hoffe/credentials/certification/azure-developer?tab=credentials-tab",
    "Microsoft Certified: DevOps Engineer Expert":
        "https://learn.microsoft.com/en-us/users/hoffe/credentials/certification/devops-engineer?tab=credentials-tab",
    "Microsoft Specialist: Architecting Microsoft Azure Solutions":
        "https://learn.microsoft.com/en-us/users/hoffe/credentials/certification-o-/nouid.2625?tab=credentials-tab",
    "Microsoft Certified Professional":
        "https://learn.microsoft.com/en-us/users/hoffe/credentials/certification-o-/nouid.1519?tab=credentials-tab",
}
ASSETS = {
    "fonts/Manrope-OFL.txt": "58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b",
    "fonts/Manrope.ttf": "3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6",
    "fonts/Newsreader-OFL.txt": "fdfad38143ec470553cae82a1e45320bdd1b9ec70415d37bd0171051d8a4ded8",
    "fonts/Newsreader.ttf": "8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1",
    "images/edge-cloud-1536.webp": "7512120f6b66badc2d06c3cce5ebbf1ef22e578828021eb59cec19c0526d9823",
    "images/edge-cloud-768.webp": "a3b721142a17d1d12ed6f34f71cd34a068bd39f9de38107815d1ab6d0026e1d0",
    "images/human-ai-review-1536.webp": "644808715863995bf01c1295f923e01238cadffce62b88c5687fbf085efac55a",
    "images/human-ai-review-768.webp": "b54c4266ba30af29dee014e4ec12013095f127ed3ddc0471f533b4520ab1df01",
    "images/linkedin-in.png": "3c0149f26168b5fe0f43e68664abe40341a6443b3cd435d18a73e12f64f8b600",
    "images/local-intelligence-1536.webp": "7fb572d18e48755c0502cbcc6f87afe5fd97efbb1022e8299a907163a5516685",
    "images/local-intelligence-768.webp": "d3f404a3b58b7a6bdf79e7ca5356eea349c09466441fcc50a50a0da8ef60f964",
    "images/logo.svg": "98459870410e77a2048dcf7888369922286776ef1d57c0becbdb73f1e7b56e4d",
    "images/medium-symbol.svg": "264674ced7a1bba760428c34269f366fdca273a2ad885d355ac302b4231c34b6",
}


class Element:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def raw_text(self):
        return "".join(child.raw_text() if isinstance(child, Element) else child
                       for child in self.children)

    def text(self):
        return " ".join(self.raw_text().split())

    def all(self, tag=None, cls=None, id=None):
        result = []
        if ((tag is None or self.tag == tag)
                and (cls is None or cls in self.attrs.get("class", "").split())
                and (id is None or self.attrs.get("id") == id)):
            result.append(self)
        for child in self.children:
            if isinstance(child, Element):
                result.extend(child.all(tag, cls, id))
        return result

    def one(self, **selector):
        result = self.all(**selector)
        if len(result) != 1:
            raise AssertionError(f"Expected one {selector}, found {len(result)}")
        return result[0]


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]
        self.errors = []
        self.feed(source)
        self.close()
        if len(self.stack) != 1:
            self.errors.append("Unclosed elements: " + ", ".join(e.tag for e in self.stack[1:]))

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs)
        self.stack[-1].children.append(element)
        if tag not in self.VOID:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.stack[-1].tag != tag:
            self.errors.append(f"Unexpected closing {tag} inside {self.stack[-1].tag}")
        else:
            self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def read_document(path):
    return Document(path.read_text(encoding="utf-8"))


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = Path(OPTIONS.site).resolve()
        cls.baseurl = "/" + OPTIONS.baseurl.strip("/") if OPTIONS.baseurl.strip("/") else ""
        cls.origin = OPTIONS.url.rstrip("/")
        cls.contract = json.loads((REPO / "tests/fixtures/content.json").read_text(encoding="utf-8"))
        cls.documents = {route: read_document(cls.site / route.lstrip("/") / "index.html")
                         for route in ROUTES}
        cls.documents["/404.html"] = read_document(cls.site / "404.html")
        cls.pages = {route: document.root for route, document in cls.documents.items()}
        cls.css = (cls.site / "assets/css/style.css").read_text(encoding="utf-8")

    def url(self, route):
        return self.origin + self.baseurl + route

    def local_file(self, reference, route):
        destination = urlsplit(urljoin(self.url(route), reference))
        if destination.scheme not in {"http", "https"} or destination.netloc != urlsplit(self.origin).netloc:
            return None, destination
        self.assertTrue(destination.path.startswith(self.baseurl + "/"), reference)
        site_path = unquote(destination.path[len(self.baseurl):]).lstrip("/")
        file = self.site / site_path
        if destination.path.endswith("/"):
            file /= "index.html"
        file = file.resolve()
        self.assertTrue(file.is_relative_to(self.site), reference)
        self.assertTrue(file.is_file(), f"{route}: missing {reference}")
        self.assertGreater(file.stat().st_size, 0, reference)
        return file, destination

    def test_four_routes_and_accessible_structure(self):
        for route, locale in ROUTES.items():
            with self.subTest(route=route):
                page = self.pages[route]
                self.assertEqual(self.documents[route].errors, [])
                self.assertEqual(page.one(tag="html").attrs["lang"], locale)
                self.assertEqual(len(page.all(tag="h1")), 1)
                self.assertEqual(page.one(tag="main").attrs, {"id": "content", "tabindex": "-1"})
                self.assertEqual(page.one(cls="skip-link").attrs["href"], "#content")
                ids = [e.attrs["id"] for e in page.all() if "id" in e.attrs]
                self.assertEqual(len(ids), len(set(ids)), "Duplicate anchor")
                for element in page.all():
                    for attribute in ("aria-labelledby", "aria-controls"):
                        for target in element.attrs.get(attribute, "").split():
                            self.assertIn(target, ids)

    def test_canonical_hreflang_and_social_metadata(self):
        for route, locale in ROUTES.items():
            with self.subTest(route=route):
                page, expected = self.pages[route], self.contract[locale]
                title_key = "project_title" if route in PROJECTS else "home_title"
                self.assertEqual(page.one(tag="title").text(), expected[title_key])
                meta = {e.attrs.get("name", e.attrs.get("property")): e.attrs.get("content")
                        for e in page.all(tag="meta")}
                self.assertEqual(meta["og:title"], expected[title_key])
                self.assertEqual(meta["og:url"], self.url(route))
                self.assertEqual(meta["og:description"], meta["description"])
                self.assertEqual(meta["og:locale"], {"en": "en_GB", "de": "de_DE"}[locale])
                self.assertEqual(meta["og:type"], "website")
                self.assertEqual(meta["og:image"], self.url("/assets/images/edge-cloud-1536.webp"))
                self.assertEqual(meta["og:image:alt"], expected["image_alts"][0])
                self.assertNotIn("robots", meta)
                self.assertGreater(len(meta["description"]), 80)
                if route in HOMES:
                    self.assertEqual(meta["description"], expected["home_description"])
                links = page.all(tag="link")
                self.assertEqual([e.attrs["href"] for e in links if e.attrs.get("rel") == "canonical"],
                                 [self.url(route)])
                pair = PROJECT_FOR if route in PROJECTS else HOME_FOR
                self.assertEqual({e.attrs["hreflang"]: e.attrs["href"]
                                  for e in links if "hreflang" in e.attrs},
                                 {"en": self.url(pair["en"]), "de": self.url(pair["de"]),
                                  "x-default": self.url(pair["en"])})

    def test_localized_navigation_and_language_destinations(self):
        for route, locale in ROUTES.items():
            with self.subTest(route=route):
                page = self.pages[route]
                links = page.one(cls="nav-links").all(tag="a")
                self.assertEqual([a.text() for a in links], self.contract[locale]["nav"])
                prefix = self.baseurl + HOME_FOR[locale] if route in PROJECTS else ""
                self.assertEqual([a.attrs["href"] for a in links],
                                 [prefix + "#services", prefix + "#approach",
                                  self.baseurl + PROJECT_FOR[locale], prefix + "#tech",
                                  prefix + "#about", prefix + "#contact"])
                self.assertEqual([a.text() for a in links if a.attrs.get("aria-current") == "page"],
                                 [self.contract[locale]["nav"][2]] if route in PROJECTS else [])
                target_locale = "de" if locale == "en" else "en"
                target = (PROJECT_FOR if route in PROJECTS else HOME_FOR)[target_locale]
                for switch in page.all(cls="language-switch"):
                    link = switch.one(tag="a")
                    self.assertEqual(link.attrs["href"], self.baseurl + target)
                    self.assertEqual(link.attrs["data-language-page"], self.baseurl + target)
                    self.assertEqual(link.attrs["lang"], target_locale)
                    self.assertEqual(link.attrs["hreflang"], target_locale)
                    self.assertEqual(switch.one(tag="span").attrs["aria-current"], "page")
                self.assertEqual(len(page.all(cls="language-switch")), 2)
                footer = page.one(tag="footer")
                legal = footer.one(cls="footer-legal")
                picker = footer.one(cls="language-switch")
                self.assertEqual(footer.text(), "Impressum English Deutsch")
                self.assertEqual(legal.tag, "span")
                self.assertNotIn("href", legal.attrs)
                self.assertNotIn("tabindex", legal.attrs)
                self.assertEqual([child for child in footer.one(cls="footer-inner").children
                                  if isinstance(child, Element)], [legal, picker])
                self.assertIs(footer.one(tag="a"), picker.one(tag="a"))
                self.assertFalse(footer.all(tag="svg") + footer.all(tag="img"))
                brand = page.one(tag="header").one(tag="a", cls="brand")
                self.assertEqual(brand.attrs["href"], self.baseurl + HOME_FOR[locale])
                self.assertEqual(brand.attrs["aria-label"],
                                 {"en": "AIPERION home", "de": "AIPERION Startseite"}[locale])

    def test_complete_services_and_preserved_home_anchors(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                main = self.pages[route].one(tag="main")
                self.assertEqual([e.attrs["id"] for e in main.all(tag="section")], SECTIONS)
                self.assertEqual(main.one(tag="h1").text(), self.contract[locale]["hero"])
                services = main.all(cls="service")
                self.assertEqual([e.one(tag="h3").text() for e in services], self.contract[locale]["services"])
                self.assertEqual([e.one(tag="h3").text() for e in main.all(cls="priority")],
                                 self.contract[locale]["services"][:3])
                self.assertEqual([len(e.one(cls="scope-list").all(tag="li")) for e in services], [3] * 5)
                self.assertEqual(len(main.all(tag="p")), 49)
                self.assertEqual(len(main.all(cls="project-entry")), 0)

    def test_anonymous_stories_retain_exact_scope_and_limits(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                work = self.pages[route].one(id="work")
                stories = work.all(cls="story")
                actual = [{"title": e.one(tag="h3").text(),
                           "paragraphs": [p.text() for p in e.all(tag="p")]} for e in stories]
                self.assertEqual(actual, self.contract[locale]["stories"])
                self.assertEqual([i for i, e in enumerate(stories)
                                  if "story-wide" in e.attrs["class"].split()], [2])
                self.assertFalse(work.all(tag="a") + work.all(tag="img") + work.all(tag="svg"))

    def test_human_led_workflow_and_engagement_balance(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                approach = self.pages[route].one(id="approach")
                expected = self.contract[locale]
                self.assertEqual([e.text() for e in approach.one(cls="engagements").all(tag="h3")],
                                 expected["engagements"])
                steps = approach.one(cls="workflow-list")
                self.assertEqual([e.text() for e in steps.all(tag="strong")], expected["workflow"])
                self.assertEqual(steps.all(tag="li")[2].text(), expected["readiness"])
                self.assertEqual(approach.one(cls="context").one(tag="strong").text(), expected["human_context"])

    def test_technology_has_explanations_and_exact_selected_inventory(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                tech, expected = self.pages[route].one(id="tech"), self.contract[locale]
                explanations = tech.one(cls="technology-context")
                self.assertEqual([e.text() for e in explanations.all(tag="h3")],
                                 expected["technology_explanations"])
                for term in ("Skills", "RAG", "MCP", "AG-UI", "A2A", "ONNX Runtime", "vLLM", ".NET"):
                    self.assertIn(term, explanations.text())
                groups = tech.all(cls="technology-group")
                self.assertEqual([e.one(tag="h4").text() for e in groups], expected["technology_groups"])
                self.assertEqual([[li.text() for li in e.all(tag="li")] for e in groups], [
                    ["Microsoft Agent Framework", "DeepEval", "Azure AI Foundry", "ONNX Runtime", "vLLM"],
                    ["C# & .NET", "Python"],
                    ["Azure DevOps", "GitHub Actions", "SonarQube", "Backstage"],
                    ["Terraform", "Bicep", "Docker"],
                    ["Microsoft Azure", expected["cncf"]],
                ])

    def test_mission_experience_and_biography_links(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                about, expected = self.pages[route].one(id="about"), self.contract[locale]
                self.assertEqual(about.one(tag="h2").text(), expected["mission"])
                self.assertEqual(about.one(cls="biography").all(tag="p")[1].text(), expected["experience"])
                self.assertIn("Christoph Hofmann", about.text())
                self.assertIn("EMEA", about.text())
                self.assertEqual({a.text(): a.attrs["href"] for a in about.one(cls="profile-links").all(tag="a")},
                                 {expected["linkedin"]: LINKEDIN, expected["medium"]: MEDIUM})
                self.assertEqual(re.findall(r"\b\d+\+", self.pages[route].one(tag="main").text()), ["10+", "50+"])

    def test_date_free_credentials_and_separate_planned_status(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                credentials = self.pages[route].one(cls="credentials")
                entries = credentials.one(cls="credential-list")
                self.assertEqual(len(entries.all(tag="li")), 5)
                self.assertEqual({a.text(): a.attrs["href"] for a in entries.all(tag="a")}, CREDENTIALS)
                self.assertEqual(entries.all(tag="li")[-1].text(), "Professional Scrum Master I, Scrum.org")
                self.assertNotRegex(credentials.text().lower(),
                                    r"\b(?:19|20)\d{2}\b|earned|expiry|expires|validity|renew|erworben|gültig|ablauf|verlänger|windows")
                self.assertEqual(credentials.one(cls="credential-summary").text(),
                                 self.contract[locale]["credential_summary"])
                self.assertEqual(credentials.one(cls="planned").one(tag="p").text(),
                                 self.contract[locale]["planned"])
                self.assertFalse(entries.all(cls="planned"))
                self.assertEqual(credentials.one(cls="text-action").attrs["href"], MS_PROFILE)

    def test_email_and_linkedin_contact(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                contact = self.pages[route].one(id="contact")
                self.assertEqual(contact.one(tag="h2").text(), self.contract[locale]["contact"])
                self.assertEqual([a.attrs["href"] for a in contact.all(tag="a")],
                                 ["mailto:info@aiperion.de", LINKEDIN])

    def test_social_logos_are_local_decorations_on_named_profile_links(self):
        assets = {
            LINKEDIN: ("linkedin-in.png", "635", "540"),
            MEDIUM: ("medium-symbol.svg", "1044", "593"),
        }
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                page = self.pages[route]
                links = page.one(tag="main").all(cls="social-link")
                self.assertEqual([link.attrs["href"] for link in links], [LINKEDIN, MEDIUM, LINKEDIN])
                self.assertEqual([link.text() for link in links[:2]],
                                 [self.contract[locale]["linkedin"], self.contract[locale]["medium"]])
                self.assertEqual(len(page.one(tag="main").all(tag="img")), 6)
                self.assertEqual(len(page.all(cls="social-logo")), 3)
                for link in links:
                    image = link.one(tag="img", cls="social-logo")
                    filename, width, height = assets[link.attrs["href"]]
                    self.assertEqual(image.attrs["src"], urlsplit(self.url("/assets/images/" + filename)).path)
                    self.assertEqual(image.attrs["alt"], "")
                    self.assertEqual((image.attrs["width"], image.attrs["height"]), (width, height))
                    self.assertEqual(image.attrs["loading"], "lazy")
                    self.assertEqual(link.one(tag="span").text(), link.text())
                    self.assertNotIn("aria-hidden", link.attrs)
                self.assertFalse(page.all(tag="iframe"))

    def test_projects_remain_one_compact_source_linked_entry(self):
        for route, locale in PROJECTS.items():
            with self.subTest(route=route):
                main, expected = self.pages[route].one(tag="main"), self.contract[locale]
                self.assertEqual(main.one(tag="h1").text(), expected["project_heading"])
                entry = main.one(cls="project-entry")
                self.assertEqual(entry.attrs["id"], "agile-agents")
                self.assertEqual(entry.one(tag="h2").text(), "Agile Agents")
                self.assertEqual(entry.one(cls="project-kind").text(), expected["project_category"])
                summary = entry.one(cls="project-summary").text()
                self.assertEqual(summary, expected["project_summary"])
                self.assertEqual(len(summary.split()), expected["project_words"])
                self.assertEqual([a.attrs["href"] for a in entry.all(tag="a")],
                                 [PROJECT + "/blob/main/LICENSE", PROJECT, PROJECT + "/blob/main/README.md"])
                self.assertEqual(len(main.all(tag="p")), 3)
                for tag in ("details", "form", "input", "img", "ol", "table", "iframe"):
                    self.assertFalse(main.all(tag=tag))

    def test_concept_images_are_caption_free_and_responsive(self):
        for route, locale in HOMES.items():
            with self.subTest(route=route):
                page = self.pages[route]
                images = [figure.one(tag="img") for figure in page.all(cls="concept-figure")]
                self.assertEqual(len(images), 3)
                self.assertEqual([e.attrs["alt"] for e in images], self.contract[locale]["image_alts"])
                self.assertFalse(page.all(tag="figcaption"))
                self.assertEqual(images[0].attrs.get("fetchpriority"), "high")
                self.assertNotEqual(images[0].attrs.get("loading"), "lazy")
                self.assertEqual([e.attrs["loading"] for e in images[1:]], ["lazy", "lazy"])
                for image in images:
                    self.assertEqual((image.attrs["width"], image.attrs["height"]), ("1536", "1024"))
                    self.assertEqual([part.split()[-1] for part in image.attrs["srcset"].split(",")],
                                     ["768w", "1536w"])
                    self.assertIn("max-width", image.attrs["sizes"])

    def test_every_local_link_anchor_and_asset_resolves(self):
        for route, page in self.pages.items():
            with self.subTest(route=route):
                for element in page.all():
                    references = [element.attrs[key] for key in ("href", "src") if key in element.attrs]
                    references += [item.strip().split()[0] for item in element.attrs.get("srcset", "").split(",") if item.strip()]
                    for reference in references:
                        file, destination = self.local_file(reference, route)
                        if file and destination.fragment and file.suffix == ".html":
                            self.assertTrue(read_document(file).root.all(id=unquote(destination.fragment)),
                                            f"{route}: missing anchor {reference}")
                    if element.tag in {"img", "script", "link"}:
                        for reference in references:
                            self.assertFalse(urlsplit(reference).netloc and
                                             element.attrs.get("rel") not in {"canonical", "alternate"}, reference)
        for reference in re.findall(r'url\(["\']?([^"\')]+)', self.css):
            self.local_file(reference, "/assets/css/style.css")
        self.assertNotIn("@import", self.css)

    def test_external_links_are_only_approved_destinations(self):
        allowed = {LINKEDIN, MEDIUM, MS_PROFILE, PROJECT, PROJECT + "/blob/main/LICENSE",
                   PROJECT + "/blob/main/README.md", *CREDENTIALS.values()}
        for route, page in self.pages.items():
            with self.subTest(route=route):
                external = {a.attrs["href"] for a in page.all(tag="a")
                            if urlsplit(a.attrs["href"]).netloc and not a.attrs["href"].startswith(self.origin + "/")}
                self.assertTrue(external.issubset(allowed), external - allowed)

    def test_approved_assets_and_font_licenses_are_preserved(self):
        for asset, expected in ASSETS.items():
            with self.subTest(asset=asset):
                self.assertEqual(hashlib.sha256((self.site / "assets" / asset).read_bytes()).hexdigest(), expected)
        for family in ("Manrope", "Newsreader"):
            self.assertIn(f'url("../fonts/{family}.ttf")', self.css)
            self.assertIn("SIL OPEN FONT LICENSE", (self.site / f"assets/fonts/{family}-OFL.txt").read_text())
        logo_source = (REPO / "docs/assets/images/logo.svg").read_text(encoding="utf-8")
        original_logo = Document(logo_source).root.one(tag="svg")
        for route in ROUTES:
            with self.subTest(logo=route):
                page = self.pages[route]
                header_logo = page.one(tag="header").one(tag="svg")
                self.assertEqual([(e.tag, e.attrs, e.text()) for e in header_logo.all()],
                                 [(e.tag, e.attrs, e.text()) for e in original_logo.all()])
                self.assertFalse(page.one(tag="footer").all(tag="svg"))
        self.assertEqual(self.css.count("font-display: swap"), 2)

    def test_navigation_and_content_are_available_before_enhancement(self):
        for route in ROUTES:
            with self.subTest(route=route):
                page = self.pages[route]
                self.assertNotIn("data-sticky", page.one(tag="header").attrs)
                self.assertNotIn("hidden", page.one(id="navigation").attrs)
                toggle = page.one(cls="menu-toggle")
                self.assertIn("hidden", toggle.attrs)
                self.assertEqual(toggle.attrs["aria-expanded"], "false")
                self.assertTrue(toggle.attrs["data-open"] and toggle.attrs["data-close"])
                self.assertFalse([e for e in page.one(tag="main").all()
                                  if "hidden" in e.attrs or e.attrs.get("aria-hidden") == "true"])
                self.assertEqual(page.one(id="hero").attrs["aria-labelledby"],
                                 page.one(tag="h1").attrs["id"])

    def test_no_review_chrome_private_files_or_client_rendered_content(self):
        forbidden = r"review-strip|review-content|data-route=|design preview|Designentwurf|noindex|nofollow|preview\.js|projects-en\.html|projects-de\.html|[\"/]en\.html|[\"/]de\.html|file://|/Users/|session-state|localhost|127\.0\.0\.1"
        for route, page in self.pages.items():
            with self.subTest(route=route):
                source_file, _ = self.local_file(route if not self.baseurl else self.baseurl + route, route)
                self.assertNotRegex(source_file.read_text(encoding="utf-8"), forbidden)
                hidden = [e for e in page.one(tag="body").all() if "hidden" in e.attrs]
                self.assertTrue(all("menu-toggle" in e.attrs.get("class", "").split() for e in hidden))
                self.assertFalse(page.one(tag="main").all(tag="script"))
                self.assertFalse(page.all(tag="iframe") + page.all(tag="form"))
        self.assertEqual({p.relative_to(self.site).as_posix() for p in self.site.rglob("*.html")},
                         {"index.html", "de/index.html", "projects/index.html", "de/projects/index.html", "404.html"})
        approved_pngs = {f"assets/{asset}" for asset in ASSETS if asset.endswith(".png")}
        for file in self.site.rglob("*"):
            if file.is_file():
                self.assertNotIn(file.suffix, {".py", ".cjs", ".json", ".penpot", ".yml", ".yaml", ".log"})
                if file.suffix == ".png":
                    self.assertIn(file.relative_to(self.site).as_posix(), approved_pngs)
                self.assertFalse(any(part in {"node_modules", "originals", "vendor", ".bundle"} for part in file.parts))
                self.assertFalse(file.name.startswith(".") or file.name in {"Gemfile", "Gemfile.lock", "README.md"})

    def test_not_found_behavior_is_retained(self):
        page = self.pages["/404.html"]
        self.assertEqual(self.documents["/404.html"].errors, [])
        self.assertEqual(page.one(tag="h1").text(), "Page not found")
        self.assertIn("The page you are looking for doesn't exist or has been moved.", page.text())
        self.assertEqual(page.one(cls="error-code").text(), "404")
        self.assertEqual(page.one(cls="primary").attrs["href"], self.baseurl + "/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default="_site", help="Jekyll output directory")
    parser.add_argument("--baseurl", default="", help="Base path used for this build")
    parser.add_argument("--url", default="https://aiperion.de", help="Canonical site origin")
    OPTIONS, unittest_args = parser.parse_known_args()
    unittest.main(argv=[sys.argv[0], *unittest_args], verbosity=2)
