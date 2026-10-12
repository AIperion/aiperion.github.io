(() => {
  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#navigation");
  const header = document.querySelector(".site-header");
  if (!toggle || !navigation || !header) return;

  const narrow = window.matchMedia("(max-width: 1199px)");
  let expanded = false;

  function measureHeader() {
    const height = header.getBoundingClientRect().height;
    const menuHeight = narrow.matches && expanded ? navigation.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty("--header-row-height", `${height - menuHeight}px`);
    document.documentElement.style.setProperty("--header-height", header.hasAttribute("data-sticky") ? `${height}px` : "0px");
  }

  function keepFocusVisible(target) {
    if (!header.hasAttribute("data-sticky") || !target.closest("main, .site-footer")) return;
    const bounds = target.getBoundingClientRect();
    const top = header.getBoundingClientRect().bottom + 8;
    if (bounds.top < top) {
      target.scrollIntoView({ block: "start", inline: "nearest" });
    } else if (bounds.bottom > window.innerHeight - 8 && bounds.height < window.innerHeight - top) {
      target.scrollIntoView({ block: "end", inline: "nearest" });
    }
  }

  function renderMenu() {
    toggle.hidden = !narrow.matches;
    navigation.hidden = narrow.matches && !expanded;
    toggle.setAttribute("aria-expanded", String(narrow.matches && expanded));
    toggle.textContent = expanded ? toggle.dataset.close : toggle.dataset.open;
    measureHeader();
  }

  function closeMenu(returnFocus = false) {
    expanded = false;
    renderMenu();
    if (returnFocus && narrow.matches) toggle.focus();
  }

  toggle.addEventListener("click", () => {
    expanded = !expanded;
    renderMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded && narrow.matches) {
      event.preventDefault();
      closeMenu(true);
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const destination = new URL(link.href);
    if (destination.origin !== window.location.origin ||
        destination.pathname !== window.location.pathname ||
        destination.search !== window.location.search) return;

    const section = document.getElementById(destination.hash.slice(1));
    if (!section) return;
    event.preventDefault();
    closeMenu();
    if (window.location.hash !== destination.hash) {
      window.history.pushState(null, "", destination.hash);
    }
    section.scrollIntoView({ block: "start" });
    const target = section.id === "content" ? section : section.querySelector("h1, h2") || section;
    target.focus({ preventScroll: true });
    updateLanguageLinks();
  });

  document.addEventListener("focusin", (event) => {
    if (header.contains(event.target)) return;
    if (expanded) closeMenu();
    requestAnimationFrame(() => keepFocusVisible(document.activeElement));
  });

  narrow.addEventListener("change", () => {
    const active = document.activeElement;
    expanded = false;
    renderMenu();
    if (narrow.matches && navigation.contains(active)) toggle.focus();
    if (!narrow.matches && active === toggle) navigation.querySelector("a").focus();
  });

  const destinations = new Set([
    "#content",
    ...Array.from(document.querySelectorAll("main [id]"), (element) => `#${element.id}`),
  ]);

  function updateLanguageLinks() {
    const hash = destinations.has(window.location.hash) ? window.location.hash : "";
    document.querySelectorAll("a[data-language-page]").forEach((link) => {
      link.setAttribute("href", link.dataset.languagePage + hash);
    });
  }

  window.addEventListener("hashchange", updateLanguageLinks);
  updateLanguageLinks();
  renderMenu();

  if ("ResizeObserver" in window) {
    header.setAttribute("data-sticky", "");
    measureHeader();
    new ResizeObserver(() => {
      measureHeader();
      keepFocusVisible(document.activeElement);
    }).observe(header);
  }

  // Correct initial deep links after fonts and reserved image slots have settled.
  window.addEventListener("load", () => {
    measureHeader();
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) target.scrollIntoView({ block: "start" });
  }, { once: true });

  const supportingImages = new Set(document.querySelectorAll(".service-media img, .workflow-media img"));
  if (!supportingImages.size || typeof IntersectionObserver !== "function" ||
      typeof Element.prototype.animate !== "function") return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const activeAnimations = new Set();
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.15 ||
          !supportingImages.delete(entry.target)) return;
      imageObserver.unobserve(entry.target);
      // Viewing an image consumes its entrance, even while reduced motion is on.
      if (reducedMotion.matches) return;
      const animation = entry.target.animate([
        { opacity: 0.88, transform: "translateY(10px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" });
      activeAnimations.add(animation);
      const release = () => activeAnimations.delete(animation);
      animation.addEventListener("finish", release, { once: true });
      animation.addEventListener("cancel", release, { once: true });
    });
  }, { threshold: 0.15 });
  supportingImages.forEach((image) => imageObserver.observe(image));
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      activeAnimations.forEach((animation) => animation.cancel());
      activeAnimations.clear();
    }
  });
})();
