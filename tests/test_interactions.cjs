/* Run against a local built site with an already-installed Playwright core and browser. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

assert.ok(process.env.SITE_URL && process.env.PLAYWRIGHT_MODULE && process.env.BROWSER_EXECUTABLE,
  "Set SITE_URL, PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE (see README).");
const base = new URL(process.env.SITE_URL.replace(/\/?$/, "/"));
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use a local test server.");
const output = process.env.EVIDENCE_DIR || ".website-build/motion-footer/browser";
assert.ok(!path.isAbsolute(output) && !path.relative(".", output).startsWith(".."),
  "Evidence must stay in a project-relative directory.");
fs.mkdirSync(output, { recursive: true });
const profile = `${output}/profile-${randomUUID()}`;
const runtime = `${output}/runtime-${randomUUID()}`;
fs.mkdirSync(profile);
fs.mkdirSync(runtime);
process.env.TMPDIR = path.resolve(runtime);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

const routes = [
  { route: "", name: "home-en", home: "", other: "de/", heading: "hero-title" },
  { route: "de/", name: "home-de", home: "de/", other: "", heading: "hero-title" },
  { route: "projects/", name: "projects-en", home: "", other: "de/projects/", heading: "projects-title" },
  { route: "de/projects/", name: "projects-de", home: "de/", other: "projects/", heading: "projects-title" },
];
const widths = [320, 390, 768, 1024, 1199, 1200, 1440];
const supportingSelectors = [".service-media img", ".workflow-media img"];
const report = {
  status: "running", url: base.href, checks: [], frames: [], scrolling: [], focus: [], motion: [],
  supportingImages: [], supportingFallbacks: [], socialLinks: [],
  contrast: [], screenshots: [], pageErrors: [], consoleErrors: [], failedRequests: [],
  externalRequests: [],
  limits: [
    "Local Chromium/Edge verification, not a cross-browser or field-performance audit.",
    "Viewport reflow and an enlarged header are tested; native browser-chrome zoom is not.",
    "Unsupported backdrop-filter is simulated by excluding the glass @supports rule.",
    "Reduced transparency is claimed only if this browser matches the emulated media feature.",
    "Motion frames include natural requestAnimationFrame samples and labeled paused native-animation poses.",
    "Approved external destinations are checked statically, not visited.",
  ],
};
let context;
let page;

const url = (route) => new URL(route, base).href;
const frame = (target) => target.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

function progress(stage) {
  fs.writeFileSync(`${output}/progress.json`, JSON.stringify({ stage, checks: report.checks.length }) + "\n");
}

async function check(name, work) {
  progress(name);
  await work();
  report.checks.push(name);
}

function observe(target) {
  target.on("pageerror", (error) => report.pageErrors.push(error.message));
  target.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  target.on("requestfailed", (request) => report.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText,
  }));
}

async function localOnly(target) {
  await target.route("**/*", async (request) => {
    if (new URL(request.request().url()).origin === base.origin) {
      await request.continue();
    } else {
      report.externalRequests.push(request.request().url());
      await request.abort();
    }
  });
}

async function visit(target, route) {
  const response = await target.goto(url(route), { waitUntil: "load" });
  if (response) assert.equal(response.status(), 200, route);
  else assert.equal(target.url(), url(route), "Same-document fragment navigation");
  await target.evaluate(() => document.fonts.ready);
}

async function settle(target) {
  await target.locator("main img").evaluateAll(async (images) => {
    for (const image of images) {
      const loading = image.getAttribute("loading");
      image.loading = "eager";
      try {
        await image.decode();
      } finally {
        if (loading === null) image.removeAttribute("loading");
        else image.setAttribute("loading", loading);
      }
    }
  });
  await target.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
}

async function capture(target, name, fullPage = false) {
  await target.screenshot({ path: `${output}/${name}.png`, fullPage, animations: "disabled" });
  report.screenshots.push(`${name}.png`);
}

async function visibleBelowHeader(target, selector, focused = false) {
  await frame(target);
  const result = await target.locator(selector).evaluate((element) => {
    const rect = (element.matches("main") ? element.querySelector("h1") : element).getBoundingClientRect();
    const header = document.querySelector(".site-header");
    return {
      top: rect.top, bottom: rect.bottom, height: rect.height,
      headerBottom: Math.max(0, header.getBoundingClientRect().bottom),
      viewport: innerHeight, active: document.activeElement === element,
      outline: getComputedStyle(element).outlineStyle,
    };
  });
  assert.ok(result.top >= result.headerBottom + 7, `${selector} clears header: ${JSON.stringify(result)}`);
  if (focused) {
    assert.equal(result.active, true, `${selector} is focused`);
    assert.equal(result.outline, "solid", `${selector} has a visible focus indicator`);
    if (result.height < result.viewport - result.headerBottom - 16) {
      assert.ok(result.bottom <= result.viewport - 7, `${selector} clears viewport bottom`);
    }
  }
  report.focus.push({ selector, ...result });
}

async function scrollingKeepsHeaderPinned(item, width) {
  const maximum = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - innerHeight));
  const samples = [];
  for (const top of [0, Math.round(maximum / 2), maximum, 0]) {
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await frame(page);
    const sample = await page.evaluate(() => {
      const header = document.querySelector(".site-header").getBoundingClientRect();
      return {
        scrollY, headerTop: header.top, headerHeight: header.height,
        headerLeft: header.left, headerWidth: header.width,
        viewportWidth: document.documentElement.clientWidth,
        contentTop: document.querySelector("main > :first-child").getBoundingClientRect().top,
        footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
      };
    });
    const initial = samples[0] || sample;
    assert.ok(Math.abs(sample.scrollY - top) <= 1, "The document reaches the requested scroll position");
    assert.equal(sample.headerTop, 0, "The header stays at the viewport top");
    assert.equal(sample.headerLeft, 0);
    assert.equal(sample.headerWidth, sample.viewportWidth);
    assert.equal(sample.headerHeight, initial.headerHeight, "Scrolling does not move or resize the header");
    assert.ok(Math.abs(sample.contentTop + sample.scrollY - initial.contentTop) < 1,
      "Page content moves with document scrolling");
    assert.ok(Math.abs(sample.footerTop + sample.scrollY - initial.footerTop) < 1,
      "The footer scrolls with the content, not with the header");
    samples.push(sample);
  }
  report.scrolling.push({ route: item.route, width, maximum, samples });
}

async function footerAndLayout(item, width) {
  await page.goto("about:blank");
  await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
  await visit(page, item.route);
  await settle(page);
  const values = await page.evaluate(() => {
    const box = (element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const logos = [".site-header .brand"].map((selector) => {
      const brand = document.querySelector(selector);
      const svg = brand.querySelector("svg");
      const text = svg.querySelector("text");
      const gradient = svg.querySelector("linearGradient");
      return {
        brand: box(brand), svg: box(svg), text: box(text), href: brand.getAttribute("href"),
        fill: getComputedStyle(text).fill, rawFill: text.getAttribute("fill"),
        overflow: getComputedStyle(svg).overflow,
        gradient: gradient.id, stops: [...gradient.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color")),
        references: [...svg.querySelectorAll("line, circle")].map((e) => e.getAttribute("stroke") || e.getAttribute("fill")),
        filter: [brand, svg, text].map((e) => getComputedStyle(e).filter),
      };
    });
    const header = document.querySelector(".site-header");
    const footer = document.querySelector(".site-footer");
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    return {
      logos, idsUnique: ids.length === new Set(ids).size,
      overflow: document.documentElement.scrollWidth > innerWidth,
      footerText: footer.textContent.replace(/\s+/g, " ").trim(),
      footerItems: [...footer.querySelector(".footer-inner").children].map((element) => element.className),
      footerMediaCount: footer.querySelectorAll("svg, img").length,
      footerLinkCount: footer.querySelectorAll("a").length,
      footerLegal: box(footer.querySelector(".footer-legal")),
      footerLanguage: box(footer.querySelector(".language-switch")),
      footerBackground: getComputedStyle(footer).backgroundColor,
      headerHeight: box(header).height, headerPosition: getComputedStyle(header).position,
      contentTop: box(document.querySelector("main > :first-child")).top,
      scrollPadding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
      menuHidden: document.querySelector("#navigation").hidden,
      toggleHidden: document.querySelector(".menu-toggle").hidden,
      imageCount: document.querySelectorAll("main img").length,
      conceptImageCount: document.querySelectorAll(".concept-figure img").length,
      socialLogoCount: document.querySelectorAll("main .social-logo").length,
    };
  });
  assert.equal(values.overflow, false, `${item.route} at ${width}px has no overflow`);
  assert.equal(values.idsUnique, true);
  assert.equal(values.footerText, "Impressum English Deutsch");
  assert.deepEqual(values.footerItems, ["footer-legal", "language-switch"]);
  assert.equal(values.footerMediaCount, 0);
  assert.equal(values.footerLinkCount, 1, "Only the other language is linked until legal content is supplied");
  assert.equal(values.footerLegal.top, values.footerLanguage.top, "The minimal footer fits on one row");
  assert.ok(values.footerLegal.right + 28 <= values.footerLanguage.left);
  assert.equal(values.footerBackground, "rgb(220, 238, 240)");
  assert.equal(values.headerPosition, "fixed");
  assert.equal(values.headerHeight, width < 1200 ? 72 : 80);
  assert.equal(values.contentTop, values.headerHeight, "Initial content has space for the pinned header");
  assert.equal(values.scrollPadding, values.headerHeight);
  assert.equal(values.menuHidden, width < 1200);
  assert.equal(values.toggleHidden, width >= 1200);
  assert.equal(values.imageCount, item.route.includes("projects") ? 0 : 6);
  assert.equal(values.conceptImageCount, item.route.includes("projects") ? 0 : 3);
  assert.equal(values.socialLogoCount, item.route.includes("projects") ? 0 : 3);
  assert.equal(values.logos[0].fill, "rgb(240, 244, 255)");
  assert.equal(values.logos[0].rawFill, "#F0F4FF");
  for (const logo of values.logos) {
    assert.equal(logo.href, new URL(item.home, base).pathname);
    assert.equal(logo.brand.width, width < 768 ? 172 : 226);
    assert.ok(logo.brand.height >= 48);
    assert.equal(logo.svg.width, width < 768 ? 136 : 180);
    assert.ok(Math.abs(logo.svg.height - logo.svg.width * 48 / 180) < 0.1);
    assert.equal(logo.overflow, "visible");
    assert.ok(logo.text.left >= logo.brand.left && logo.text.right <= logo.brand.right);
    assert.ok(logo.text.top >= logo.brand.top && logo.text.bottom <= logo.brand.bottom);
    assert.deepEqual(logo.stops, ["#2563EB", "#06B6D4"]);
    assert.deepEqual(logo.references, Array(6).fill(`url(#${logo.gradient})`));
    assert.deepEqual(logo.filter, ["none", "none", "none"]);
  }
  await scrollingKeepsHeaderPinned(item, width);
  if (width === 320) {
    const noCSS = await page.evaluate(() => {
      const sheets = [...document.styleSheets];
      sheets.forEach((sheet) => { sheet.disabled = true; });
      try {
        return getComputedStyle(document.querySelector(".site-header text")).fill;
      } finally {
        sheets.forEach((sheet) => { sheet.disabled = false; });
      }
    });
    assert.equal(noCSS, "rgb(240, 244, 255)",
      "The header retains its intrinsic SVG fill without any CSS");
    await settle(page);
  }
  await page.locator("main a").last().focus();
  await page.keyboard.press("Tab");
  await visibleBelowHeader(page, ".site-footer a[data-language-page]", true);
  const focus = await page.locator(".site-footer a[data-language-page]").evaluate((e) => {
    const style = getComputedStyle(e);
    return [style.outlineWidth, style.outlineOffset, style.outlineColor];
  });
  assert.deepEqual(focus, ["3px", "4px", "rgb(29, 78, 216)"]);
  if (width === 320 || width === 1440) {
    if (item.name === "home-en" && width === 1440 || item.name === "projects-de" && width === 320) {
      const filename = `footer-${item.name}-${width}-focus.png`;
      await page.locator(".site-footer").screenshot({ path: `${output}/${filename}`, animations: "disabled" });
      report.screenshots.push(filename);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await frame(page);
    await capture(page, `${item.name}-${width}-final`, true);
    await page.locator(".site-footer a[data-language-page]").focus();
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.keyboard.press("Enter"),
    ]);
    assert.equal(page.url(), url(item.other), "Footer Enter opens the matching page in the other language");
    await settle(page);
  }
  report.frames.push({ route: item.route, width, ...values });
}

async function socialLinkJourney(item, width) {
  page = await context.newPage();
  observe(page);
  await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
  await visit(page, item.route + "#about");
  await settle(page);
  await page.keyboard.press("Tab");
  const links = [
    ["#about .profile-links li:first-child a", "linkedin-in.png"],
    ["#about .profile-links li:last-child a", "medium-symbol.svg"],
    ["#contact .social-link", "linkedin-in.png"],
  ];
  for (const [selector, asset] of links) {
    const link = page.locator(selector);
    await link.focus();
    await visibleBelowHeader(page, selector, true);
    const state = await link.evaluate((element) => {
      const image = element.querySelector("img");
      const label = element.querySelector("span");
      const rect = (e) => {
        const { left, top, right, bottom, width, height } = e.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const style = getComputedStyle(image);
      const linkStyle = getComputedStyle(element);
      const term = element.closest("dd")?.previousElementSibling;
      return {
        label: label.textContent, source: image.getAttribute("src"), alt: image.alt,
        complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        image: rect(image), text: rect(label), link: rect(element),
        termBottom: term ? rect(term).bottom : null,
        outlineTop: rect(element).top - parseFloat(linkStyle.outlineWidth) - parseFloat(linkStyle.outlineOffset),
        opacity: style.opacity, filter: style.filter, transform: style.transform,
      };
    });
    assert.equal(state.source, new URL("assets/images/" + asset, base).pathname);
    assert.equal(state.alt, "");
    assert.equal(state.complete, true);
    assert.ok(state.naturalWidth > 0 && state.naturalHeight > 0);
    assert.equal(state.image.height, 28);
    assert.ok(Math.abs(state.image.width - 28 * state.naturalWidth / state.naturalHeight) < 0.25,
      "The supplied logo retains its aspect ratio");
    assert.ok(state.link.height >= 48, "Logo links retain a comfortable target");
    assert.ok(state.text.left >= state.image.right + 19.9, "Logo and label have clear separation");
    assert.ok(state.text.right <= state.link.right + 0.1 && state.link.right <= width,
      "Localized labels fit without horizontal clipping");
    if (state.termBottom !== null) {
      assert.ok(state.outlineTop >= state.termBottom + 0.9,
        "The contact link's focus outline does not cross its platform label");
    }
    assert.deepEqual([state.opacity, state.filter, state.transform], ["1", "none", "none"]);
    assert.equal(await page.getByRole("link", { name: state.label, exact: true }).count(), 1,
      "The visible label is the accessible link name without a duplicate logo announcement");
    report.socialLinks.push({ route: item.route, width, selector, ...state });
  }
  await capture(page, `social-contact-${item.name}-${width}`);
  await page.locator("#about .profile-links li:first-child a").focus();
  await visibleBelowHeader(page, "#about .profile-links li:first-child a", true);
  await capture(page, `social-profiles-${item.name}-${width}`);
  await page.close();
}

async function navigationJourneys(item, width) {
  page = await context.newPage();
  observe(page);
  await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
  await visit(page, item.route);
  await settle(page);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".skip-link").evaluate((e) => e === document.activeElement), true);
  await page.keyboard.press("Enter");
  await visibleBelowHeader(page, "main", true);
  if (width < 1200) await page.locator(".menu-toggle").click();
  await page.locator('#navigation a[href$="#services"]').click();
  await page.waitForURL(url(item.home + "#services"));
  await settle(page);
  await visibleBelowHeader(page, "#services h2");
  if (width < 1200) await page.locator(".menu-toggle").click();
  const languageLink = page.locator("#navigation a[data-language-page]");
  const otherHome = item.home ? "" : "de/";
  assert.equal(await languageLink.getAttribute("href"), new URL(otherHome + "#services", base).pathname + "#services");
  await languageLink.click();
  await page.waitForURL(url(otherHome + "#services"));
  await settle(page);
  await visibleBelowHeader(page, "#services h2");

  const hashes = item.route.includes("projects")
    ? ["agile-agents", "agile-agents-title", "content", "projects-title"]
    : ["services", "work", "approach", "tech", "about", "contact", "content", "hero-title"];
  for (const hash of hashes) {
    await visit(page, item.route + "#" + hash);
    await settle(page);
    await visibleBelowHeader(page, "#" + hash);
  }
  if (item.route.includes("projects")) {
    await visit(page, item.route + "#agile-agents");
    if (width < 1200) await page.locator(".menu-toggle").click();
    await page.locator("#navigation a[data-language-page]").click();
    await page.waitForURL(url(item.other + "#agile-agents"));
    await settle(page);
    await visibleBelowHeader(page, "#agile-agents");
    await page.locator(".project-identity a").focus();
    await page.keyboard.press("Tab");
    await visibleBelowHeader(page, ".project-actions .primary", true);
  }
  if (width < 1200) {
    await visit(page, item.route);
    await settle(page);
    await page.locator(".menu-toggle").click();
    await page.locator("#navigation a[data-language-page]").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
    await visibleBelowHeader(page, item.route.includes("projects")
      ? ".project-identity .text-action" : ".hero-actions .primary", true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator(".menu-toggle").evaluate((e) => e === document.activeElement), true);
    await page.keyboard.press("Enter");
    await page.locator("#navigation a").first().focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu-toggle").evaluate((e) => e === document.activeElement), true);
    assert.equal(await page.locator("#navigation").isVisible(), false);
  }
  const footerHash = item.route.includes("projects") ? "agile-agents" : "work";
  await visit(page, item.route + "#" + footerHash);
  await settle(page);
  const footerLanguage = page.locator(".site-footer a[data-language-page]");
  assert.equal(await footerLanguage.getAttribute("href"), new URL(item.other + "#" + footerHash, base).pathname + "#" + footerHash);
  await footerLanguage.focus();
  await visibleBelowHeader(page, ".site-footer a[data-language-page]", true);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.keyboard.press("Enter"),
  ]);
  assert.equal(page.url(), url(item.other + "#" + footerHash));
  await settle(page);
  await visibleBelowHeader(page, "#" + footerHash);
  await page.close();
}

async function resizingMenu() {
  page = await context.newPage();
  observe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "de/");
  await settle(page);
  const closedContentTop = await page.locator("main > :first-child").evaluate((e) =>
    e.getBoundingClientRect().top);
  await page.locator(".menu-toggle").click();
  await settle(page);
  const expandedContentTop = await page.locator("main > :first-child").evaluate((e) =>
    e.getBoundingClientRect().top);
  assert.equal(expandedContentTop, closedContentTop, "Opening the pinned menu does not shift page content");
  await page.setViewportSize({ width: 320, height: 480 });
  await settle(page);
  const short = await page.locator("#navigation").evaluate((e) => ({
    client: e.clientHeight, scroll: e.scrollHeight, bottom: e.getBoundingClientRect().bottom,
    header: document.querySelector("header").getBoundingClientRect().height,
  }));
  assert.ok(short.scroll > short.client, "Short menu is internally scrollable");
  assert.ok(short.bottom <= 480 && short.header <= 480);
  await page.locator("#navigation a[data-language-page]").focus();
  assert.ok(await page.locator("#navigation").evaluate((e) => e.scrollTop > 0));
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.locator(".menu-toggle").waitFor({ state: "hidden" });
  await settle(page);
  assert.equal(await page.locator("#navigation a").first().evaluate((e) => e === document.activeElement), true);
  await page.setViewportSize({ width: 1199, height: 900 });
  await page.locator("#navigation").waitFor({ state: "hidden" });
  await settle(page);
  assert.equal(await page.locator(".menu-toggle").evaluate((e) => e === document.activeElement), true);
  await page.setViewportSize({ width: 320, height: 480 });
  const tallControl = await page.addStyleTag({ content: ".menu-toggle { min-height: 88px; }" });
  await page.locator(".menu-toggle").click();
  await settle(page);
  const tall = await page.evaluate(() => ({
    row: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-row-height")),
    menu: document.querySelector("#navigation").getBoundingClientRect().height,
    header: document.querySelector("header").getBoundingClientRect().height,
    contentOffset: parseFloat(getComputedStyle(document.querySelector("main")).paddingTop),
  }));
  assert.equal(tall.row, 112, "Offset follows actual header growth, not a hardcoded 72px");
  assert.equal(tall.contentOffset, tall.row, "Reserved content space follows the enlarged closed row");
  assert.equal(tall.menu, 368);
  assert.equal(tall.header, 480);
  await page.locator('#navigation a[href="#services"]').focus();
  await page.keyboard.press("Enter");
  await visibleBelowHeader(page, "#services h2", true);
  await tallControl.evaluate((e) => e.remove());
  report.menuResize = { closedContentTop, expandedContentTop, short, tall };
  await page.close();
}

function installMotionSampler() {
  window.sampleMotion = (selector, duration) => {
    const elements = [...document.querySelectorAll(selector)];
    const samples = [];
    const start = performance.now();
    const record = () => {
      samples.push({
        time: performance.now() - start,
        elements: elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            opacity: Number(style.opacity), transform: style.transform,
            y: style.transform === "none" ? 0 : new DOMMatrixReadOnly(style.transform).m42,
            identity: style.transform === "none" || new DOMMatrixReadOnly(style.transform).isIdentity,
            animations: element.getAnimations().map((animation) => ({
              state: animation.playState, duration: animation.effect.getTiming().duration,
              delay: animation.effect.getTiming().delay,
            })),
          };
        }),
      });
      const elapsed = performance.now() - start;
      const running = samples.at(-1).elements.some((element) =>
        element.animations.some((animation) => animation.state === "running"));
      if (elapsed >= duration && !running) return Promise.resolve(samples);
      if (elapsed >= duration + 2000) {
        return Promise.reject(new Error(`Animations did not settle: ${selector}`));
      }
      return new Promise((resolve) => requestAnimationFrame(() => resolve(record())));
    };
    return record();
  };
  document.addEventListener("DOMContentLoaded", () => {
    window.introMotion = window.sampleMotion(".hero-copy, .hero-media, .project-intro h1, .project-intro .intro", 650);
  }, { once: true });
}

function assertMotion(samples, reduced, name) {
  assert.ok(samples.length > 2, `${name} has real successive frame samples`);
  const elements = samples.flatMap((sample) => sample.elements);
  assert.ok(elements.length, `${name} has measured elements`);
  if (reduced) {
    assert.ok(elements.every((e) => e.opacity === 1 && e.transform === "none" && !e.animations.length),
      `${name}: reduced motion is static from the first sample`);
  } else {
    assert.ok(elements.some((e) => e.opacity < 0.99 && Math.abs(e.y) > 0.1), `${name} actually moves and fades`);
    assert.ok(elements.every((e) => e.opacity > 0), `${name} never starts hidden`);
    assert.ok(elements.some((e) => e.animations.some((a) => a.state === "running")), `${name} runs in the browser`);
    assert.ok(samples.at(-1).elements.every((e) => e.opacity === 1 && e.identity), `${name} settles`);
  }
}

function installSupportingProbe() {
  window.supportingMotions = [];
  const animate = Element.prototype.animate;
  if (typeof animate !== "function") return;
  Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args);
    const selector = [".service-media img", ".workflow-media img"].find((selector) => this.matches(selector));
    window.supportingMotions.push({
      selector: selector || "unexpected", animation,
      samples: selector ? window.sampleMotion(selector, 650) : Promise.resolve([]),
    });
    return animation;
  };
}

async function supportingImageJourney(item, width) {
  page = await context.newPage();
  observe(page);
  await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
  await page.addInitScript(installMotionSampler);
  await page.addInitScript(installSupportingProbe);
  await visit(page, item.route);
  await settle(page);
  assert.equal(await page.evaluate(() => window.supportingMotions.length), 0, "No supporting motion before entry");
  const result = { route: item.route, width, images: [] };
  report.supportingImages.push(result);
  for (const selector of supportingSelectors) {
    assert.equal(await page.locator(selector).evaluate((e) => getComputedStyle(e).opacity), "1",
      "The image is already visible before its observer fires");
    await page.locator(selector).evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForFunction((selector) => window.supportingMotions.some((m) => m.selector === selector), selector);
    const samples = await page.evaluate((selector) =>
      window.supportingMotions.find((m) => m.selector === selector).samples, selector);
    assertMotion(samples, false, selector);
    const states = samples.flatMap((sample) => sample.elements);
    assert.ok(states.every((state) => state.opacity >= 0.85 && state.y >= 0 && state.y <= 10));
    assert.equal(states[0].animations[0].duration, 560);
    assert.equal(states.at(-1).transform, "none", "Finished images return to their normal style");
    result.images.push({ selector, samples });
    if (item.name === "home-en" && width === 1440) {
      const name = selector.includes("service") ? "service-media" : "workflow-media";
      await capture(page, `supporting-${name}-final`);
      await page.evaluate((selector) => {
        const { animation } = window.supportingMotions.find((m) => m.selector === selector);
        animation.pause();
        animation.currentTime = 120;
      }, selector);
      await frame(page);
      const filename = `supporting-${name}-at-120ms.png`;
      await page.screenshot({ path: `${output}/${filename}`, animations: "allow" });
      report.screenshots.push(filename);
      await page.evaluate((selector) =>
        window.supportingMotions.find((m) => m.selector === selector).animation.finish(), selector);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await frame(page);
    await page.locator(selector).evaluate((e) => e.scrollIntoView({ block: "center" }));
    const replay = await page.evaluate((selector) => window.sampleMotion(selector, 240), selector);
    assertMotion(replay, true, `${selector} does not replay`);
    assert.equal(await page.evaluate((selector) =>
      window.supportingMotions.filter((m) => m.selector === selector).length, selector), 1);
  }
  assert.deepEqual(await page.evaluate(() => window.supportingMotions.map((m) => m.selector)), supportingSelectors,
    "Only the two supporting images animate, once each");
  await page.close();
}

async function supportingImageFallbacks() {
  for (const mode of ["live-reduce", "initial-reduce", "no-observer", "no-animate"]) {
    page = await context.newPage();
    observe(page);
    await page.setViewportSize({ width: 320, height: 480 });
    await page.emulateMedia({ reducedMotion: mode === "initial-reduce" ? "reduce" : "no-preference" });
    await page.addInitScript(installMotionSampler);
    await page.addInitScript(installSupportingProbe);
    await page.addInitScript((mode) => {
      if (mode === "no-observer") delete window.IntersectionObserver;
      if (mode === "no-animate") delete Element.prototype.animate;
    }, mode);
    await visit(page, "");
    await settle(page);
    const result = { mode, samples: [] };
    report.supportingFallbacks.push(result);
    if (mode === "live-reduce") {
      await page.locator(supportingSelectors[0]).evaluate((e) => e.scrollIntoView({ block: "center" }));
      await page.waitForFunction(() => window.supportingMotions[0]?.animation.playState === "running");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => window.supportingMotions[0].animation.playState === "idle");
      result.cancelled = await page.evaluate(() => ({
        state: window.supportingMotions[0].animation.playState,
        currentTime: window.supportingMotions[0].animation.currentTime,
      }));
      assert.deepEqual(result.cancelled, { state: "idle", currentTime: null });
    }
    for (const selector of supportingSelectors) {
      await page.locator(selector).evaluate((e) => e.scrollIntoView({ block: "center" }));
      const samples = await page.evaluate((selector) => window.sampleMotion(selector, 650), selector);
      assertMotion(samples, true, `${mode}: ${selector} stays static`);
      result.samples.push({ selector, samples });
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const selector of supportingSelectors) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await frame(page);
      await page.locator(selector).evaluate((e) => e.scrollIntoView({ block: "center" }));
      const replay = await page.evaluate((selector) => window.sampleMotion(selector, 240), selector);
      assertMotion(replay, true, `${mode}: no replay after opting back into motion`);
    }
    result.animationCalls = await page.evaluate(() => window.supportingMotions.length);
    assert.equal(result.animationCalls, mode === "live-reduce" ? 1 : 0);
    await page.close();
  }
}

async function motionJourney(item, width, reduced) {
  page = await context.newPage();
  observe(page);
  await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.addInitScript(installMotionSampler);
  await visit(page, item.route);
  const samples = await page.evaluate(() => window.introMotion);
  const result = { route: item.route, width, reduced, intro: samples };
  report.motion.push(result);
  assertMotion(samples, reduced, item.name + " intro");
  if (!reduced) {
    const timings = samples[0].elements.map((e) => e.animations[0]);
    assert.deepEqual(timings.map((e) => e.duration), [520, 520]);
    assert.deepEqual(timings.map((e) => e.delay), [0, 60]);
  }
  await settle(page);
  if (width === 320) {
    await page.locator(".menu-toggle").evaluate((e) => e.addEventListener("click", () => {
      window.menuMotion = window.sampleMotion("#navigation", 240);
    }, { once: true }));
    await page.locator(".menu-toggle").click();
    const menu = await page.evaluate(() => window.menuMotion);
    result.menu = menu;
    assertMotion(menu, reduced, item.name + " menu");
    await page.keyboard.press("Escape");
  }
  if (item.name === "home-en" && width === 1440) {
    await page.mouse.move(0, 0);
    const primary = page.locator(".hero-actions .primary");
    await primary.evaluate((e) => e.addEventListener("pointerenter", () => {
      window.buttonMotion = window.sampleMotion(".hero-actions .primary", 240);
    }, { once: true }));
    await primary.hover();
    const button = await page.evaluate(() => window.buttonMotion);
    const states = button.flatMap((sample) => sample.elements);
    assert.equal(states.at(-1).y, reduced ? 0 : -2);
    assert.equal(states.some((e) => e.animations.some((a) => a.state === "running")), !reduced);
    await page.mouse.down();
    await page.waitForFunction((reduce) => {
      const style = getComputedStyle(document.querySelector(".hero-actions .primary"));
      return reduce ? style.transform === "none" : new DOMMatrixReadOnly(style.transform).m42 === 1;
    }, reduced);
    await page.mouse.up();
    await visibleBelowHeader(page, "#contact h2");
    assert.equal(await page.locator("#contact h2").evaluate((e) => e === document.activeElement), true);
    result.button = button;
  }
  if (!reduced && width === 1440 && ["home-en", "projects-en"].includes(item.name)) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll(".hero-copy, .hero-media, .project-intro h1, .project-intro .intro")
        .forEach((e) => e.getAnimations().forEach((a) => { a.pause(); a.currentTime = 120; }));
    });
    await frame(page);
    const filename = `${item.name}-motion-at-120ms.png`;
    await page.screenshot({ path: `${output}/${filename}`, animations: "allow" });
    report.screenshots.push(filename);
  }
  await page.close();
}

function luminance(rgb) {
  return rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const colorChannels = (color) => color.match(/[\d.]+/g).map(Number);

async function transparency() {
  page = await context.newPage();
  observe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, "");
  await settle(page);
  for (const selector of [".hero-media img", ".service-media img", "#work", "#tech", "#contact"]) {
    await page.locator(selector).evaluate((e) => {
      const bounds = e.getBoundingClientRect();
      window.scrollBy(0, bounds.top + Math.min(160, bounds.height / 2));
    });
    await frame(page);
    const style = await page.locator("header").evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor, blur: getComputedStyle(e).backdropFilter,
      border: getComputedStyle(e).boxShadow,
      textColor: getComputedStyle(e.querySelector(".nav-links a")).color,
    }));
    assert.equal(style.background, "rgba(16, 42, 54, 0.85)");
    assert.equal(style.blur, "blur(16px)");
    assert.notEqual(style.border, "none");
    await page.locator(".header-inner").evaluate((e) => { e.style.visibility = "hidden"; });
    let image;
    try {
      image = await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 80 } });
    } finally {
      await page.locator(".header-inner").evaluate((e) => e.style.removeProperty("visibility"));
    }
    const pixels = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const drawing = canvas.getContext("2d");
      drawing.drawImage(image, 0, 0);
      return [120, 500, 850, 1100, 1320].map((x) =>
        [...drawing.getImageData(x, 40, 1, 1).data].slice(0, 3));
    }, image.toString("base64"));
    const ratios = pixels.map((pixel) => contrast(colorChannels(style.textColor), pixel));
    assert.ok(ratios.every((ratio) => ratio >= 4.5), `${selector}: rendered glass text contrast`);
    report.contrast.push({ selector, ...style, pixels, ratios });
    await capture(page, `glass-over-${selector.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`);
  }
  assert.ok(new Set(report.contrast.flatMap((sample) => sample.pixels.map(String))).size > 1,
    "The rendered background changes with the underlying sections and images");
  const solidColors = await page.evaluate(() => ({
    primary: [getComputedStyle(document.querySelector(".nav-links .primary")).color,
      getComputedStyle(document.querySelector(".nav-links .primary")).backgroundColor],
    footer: [getComputedStyle(document.querySelector(".footer-legal")).color,
      getComputedStyle(document.querySelector(".site-footer")).backgroundColor],
  }));
  const [red, green, blue, alpha] = colorChannels(report.contrast[0].background);
  report.contrastBounds = {
    whiteBehindGlass: contrast(colorChannels(report.contrast[0].textColor),
      [red, green, blue].map((c) => c * alpha + 255 * (1 - alpha))),
    primary: contrast(...solidColors.primary.map(colorChannels)),
    footerText: contrast(...solidColors.footer.map(colorChannels)),
  };
  assert.ok(Object.values(report.contrastBounds).every((ratio) => ratio >= 4.5));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  report.reducedTransparency = await page.evaluate(() => ({
    matches: matchMedia("(prefers-reduced-transparency: reduce)").matches,
    background: getComputedStyle(document.querySelector("header")).backgroundColor,
    blur: getComputedStyle(document.querySelector("header")).backdropFilter,
  }));
  if (report.reducedTransparency.matches) {
    assert.equal(report.reducedTransparency.background, "rgb(16, 42, 54)");
    assert.equal(report.reducedTransparency.blur, "none");
  } else {
    report.limits.push("This browser did not expose reduced-transparency emulation; no support claim is made.");
  }
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  const excluded = await page.evaluate(() => {
    let count = 0;
    for (const sheet of document.styleSheets) {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const rule = sheet.cssRules[i];
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes("backdrop-filter")) {
          sheet.deleteRule(i);
          count++;
        }
      }
    }
    return count;
  });
  assert.equal(excluded, 1, "Simulate the glass @supports condition not matching");
  report.noBackdropFallback = await page.locator("header").evaluate((e) => ({
    background: getComputedStyle(e).backgroundColor, blur: getComputedStyle(e).backdropFilter,
  }));
  assert.deepEqual(report.noBackdropFallback, { background: "rgb(16, 42, 54)", blur: "none" });
  await page.close();
}

async function withoutEnhancement() {
  const noJS = await context.browser().newContext({ javaScriptEnabled: false });
  await localOnly(noJS);
  try {
    for (const item of routes) {
      for (const width of [320, 1440]) {
        page = await noJS.newPage();
        observe(page);
        await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
        await visit(page, item.route);
        await settle(page);
        assert.equal(await page.locator("#navigation").isVisible(), true);
        assert.equal(await page.locator(".menu-toggle").isVisible(), false);
        assert.equal(await page.locator("header").evaluate((e) => getComputedStyle(e).position), "relative");
        assert.equal(await page.locator("main").evaluate((e) => getComputedStyle(e).paddingTop), "0px");
        assert.equal(await page.locator(".footer-founder").count(), 0);
        for (const image of await page.locator(supportingSelectors.join(", ")).all()) {
          await image.evaluate((e) => e.scrollIntoView({ block: "center" }));
          const state = await image.evaluate((e) => ({
            opacity: getComputedStyle(e).opacity, transform: getComputedStyle(e).transform,
            animations: e.getAnimations().length,
          }));
          assert.deepEqual(state, { opacity: "1", transform: "none", animations: 0 },
            "Supporting images remain static and visible without JavaScript");
        }
        await page.locator("main a").first().focus();
        const bounds = await page.locator("main a").first().boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= (width === 320 ? 480 : 900));
        const heading = item.route.includes("projects") ? "agile-agents" : "services";
        await visit(page, item.route + "#" + heading);
        await settle(page);
        assert.ok((await page.locator("#" + heading).boundingBox()).y >= 0);
        assert.equal(await page.locator("a[data-language-page]").first().getAttribute("href"),
          new URL(item.other, base).pathname, "No-JS language links still reach the matching document");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.close();
      }
    }
  } finally {
    await noJS.unrouteAll({ behavior: "wait" });
    await noJS.close();
  }
  page = await context.newPage();
  observe(page);
  await page.addInitScript(() => { delete window.ResizeObserver; });
  await page.setViewportSize({ width: 320, height: 480 });
  await visit(page, "#services");
  assert.equal(await page.locator("header").evaluate((e) => getComputedStyle(e).position), "relative");
  assert.equal(await page.locator("header").getAttribute("data-sticky"), null);
  assert.equal(await page.locator("main").evaluate((e) => getComputedStyle(e).paddingTop), "0px");
  assert.equal(await page.locator("main").isVisible(), true);
  await page.locator(".menu-toggle").click();
  await page.locator('#navigation a[href="#contact"]').focus();
  await page.keyboard.press("Enter");
  await visibleBelowHeader(page, "#contact h2", true);
  await page.close();
}

(async () => {
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.BROWSER_EXECUTABLE, headless: true,
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
      reducedMotion: "no-preference", args: ["--disable-background-networking", "--no-first-run"],
    });
    report.browser = context.browser().version();
    await context.tracing.start({ screenshots: true, snapshots: true });
    await localOnly(context);
    page = await context.newPage();
    observe(page);
    for (const item of routes) {
      for (const width of widths) {
        await check(`${item.name} layout/footer at ${width}px`, () => footerAndLayout(item, width));
      }
    }
    await page.close();
    for (const item of routes) {
      for (const width of [320, 1200]) {
        await check(`${item.name} keyboard/anchors at ${width}px`, () => navigationJourneys(item, width));
      }
      for (const reduced of [false, true]) {
        for (const width of [320, 1440]) {
          await check(`${item.name} ${reduced ? "reduced" : "normal"} motion at ${width}px`,
            () => motionJourney(item, width, reduced));
        }
      }
    }
    await check("Mobile menu resize, breakpoint focus and measured header growth", resizingMenu);
    await check("Rendered glass contrast, reduced transparency and solid fallback", transparency);
    await check("No JavaScript and no ResizeObserver fallbacks", withoutEnhancement);
    for (const item of routes.filter((item) => !item.route.includes("projects"))) {
      for (const width of [320, 1440]) {
        await check(`${item.name} local social logos and accessible links at ${width}px`,
          () => socialLinkJourney(item, width));
        await check(`${item.name} supporting images enter once at ${width}px`,
          () => supportingImageJourney(item, width));
      }
    }
    await check("Supporting images honor live/initial reduced motion and unsupported APIs", supportingImageFallbacks);
    page = await context.newPage();
    observe(page);
    await visit(page, "404.html");
    assert.equal(await page.locator("footer").count(), 0, "404 has no shared footer");
    assert.equal(await page.locator("h1").textContent(), "Page not found");
    progress("Draining local request handlers");
    await context.unrouteAll({ behavior: "wait" });
    for (const key of ["pageErrors", "consoleErrors", "failedRequests", "externalRequests"]) {
      assert.deepEqual(report[key], [], key);
    }
    progress("Stopping trace");
    await context.tracing.stop();
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.stack;
    process.exitCode = 1;
    if (page && !page.isClosed()) {
      try {
        await capture(page, "failure");
      } catch (captureError) {
        report.captureError = captureError.message;
      }
    }
    if (context) {
      try {
        await context.tracing.stop({ path: `${output}/failure-trace.zip` });
      } catch (traceError) {
        report.traceError = traceError.message;
      }
    }
  } finally {
    progress("Closing browser");
    if (context) await context.close();
    progress("Removing owned browser files");
    fs.rmSync(profile, { recursive: true });
    fs.rmSync(runtime, { recursive: true });
    report.browserClosed = true;
    fs.writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2) + "\n");
    progress("Complete");
    console.log(JSON.stringify({
      status: report.status, browser: report.browser, checks: report.checks.length,
      frames: report.frames.length, motionRuns: report.motion.length,
      contrast: report.contrastBounds, evidence: output, error: report.error,
    }, null, 2));
  }
})();
