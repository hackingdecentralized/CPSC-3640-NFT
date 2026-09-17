/**
 * The six example designs, as a slideshow.
 *
 * CSS scroll snapping does the sliding, so swipes, trackpads and keyboard scrolling
 * all work natively. This module adds the arrows, the dots, the caption, and a slow
 * auto-advance that waits while someone is looking closely and never runs for people
 * who ask for reduced motion.
 */
import type {Design} from "./card";

const ADVANCE_MS = 3500;
/** After someone picks a slide themselves, leave it there for a while. */
const HOLD_AFTER_INTERACTION_MS = 10_000;

/** The slide on show. Kept here so a re-render does not jump back to the first. */
let current = 0;
let heldUntil = 0;
/**
 * While a scroll this module started is still moving, the positions it passes
 * through, including the one it starts from, are not the visitor's choice.
 */
let steeringUntil = 0;
let hovering = false;
let timer: number | undefined;
let resizeBound = false;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function slideshowHtml(designs: Design[] | undefined, escape: (value: string) => string): string {
  if (!designs) {
    return `<div class="slideshow" aria-hidden="true">
      <div class="slide-stage"><div class="slides"><div class="slide"><div class="tile"></div></div></div></div>
      <p class="slide-caption">&nbsp;</p>
    </div>`;
  }
  const slides = designs
    .map(
      ({label, odds, sample}, i) => `<figure class="slide" aria-roledescription="slide"
        aria-label="${escape(label)}, ${odds}% of cards" data-label="${escape(label)}" data-odds="${odds}">
        <img src="${sample}" alt="Example ${escape(label)} card" width="1024" height="1024"
          ${i === 0 ? 'fetchpriority="high"' : 'fetchpriority="low"'} />
      </figure>`
    )
    .join("");
  const dots = designs
    .map(({label}, i) => `<button type="button" data-slide="${i}" aria-label="Show ${escape(label)}"></button>`)
    .join("");
  // The caption and dots start on the first slide; mountSlideshow moves them to
  // `current` before the browser paints.
  return `<div class="slideshow" aria-roledescription="carousel" aria-label="The six card designs">
    <div class="slide-stage">
      <div class="slides" tabindex="0">${slides}</div>
      <button type="button" class="slide-nav prev" data-step="-1" aria-label="Previous design">&#8249;</button>
      <button type="button" class="slide-nav next" data-step="1" aria-label="Next design">&#8250;</button>
    </div>
    <p class="slide-caption"><strong>${escape(designs[0]!.label)}</strong> <span>${designs[0]!.odds}% of cards</span></p>
    <div class="slide-dots">${dots}</div>
  </div>`;
}

function parts(host: ParentNode) {
  const slides = host.querySelector<HTMLElement>(".slideshow .slides");
  if (!slides) return null;
  const figures = [...slides.querySelectorAll<HTMLElement>(".slide[data-label]")];
  if (figures.length === 0) return null;
  const show = slides.closest<HTMLElement>(".slideshow")!;
  return {show, slides, figures};
}

function reflect(host: ParentNode): void {
  const found = parts(host);
  if (!found) return;
  const {show, figures} = found;
  const figure = figures[current]!;
  const caption = show.querySelector(".slide-caption");
  if (caption) {
    caption.innerHTML = "";
    const name = document.createElement("strong");
    name.textContent = figure.dataset.label ?? "";
    const odds = document.createElement("span");
    odds.textContent = `${figure.dataset.odds}% of cards`;
    caption.append(name, " ", odds);
  }
  show.querySelectorAll<HTMLElement>(".slide-dots button").forEach((dot, i) => {
    if (i === current) dot.setAttribute("aria-current", "true");
    else dot.removeAttribute("aria-current");
  });
}

function go(host: ParentNode, to: number, smooth: boolean): void {
  const found = parts(host);
  if (!found) return;
  const {slides, figures} = found;
  current = ((to % figures.length) + figures.length) % figures.length;
  const animate = smooth && !reducedMotion();
  steeringUntil = Date.now() + (animate ? 2000 : 300);
  slides.scrollTo({left: current * slides.clientWidth, behavior: animate ? "smooth" : "instant"});
  reflect(host);
}

/** Wire up a freshly rendered slideshow. Call whenever its HTML has been replaced. */
export function mountSlideshow(host: HTMLElement): void {
  const found = parts(host);
  if (!found) return;
  const {show, slides, figures} = found;
  if (current >= figures.length) current = 0;
  go(host, current, false);

  let frame = 0;
  slides.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const width = slides.clientWidth;
      if (width === 0) return;
      const at = Math.round(slides.scrollLeft / width);
      // Only a slide that has come to rest counts.
      const resting = Math.abs(slides.scrollLeft - at * width) < 2;
      if (Date.now() < steeringUntil) {
        if (resting && at === current) steeringUntil = 0;
        return;
      }
      if (resting && at !== current && at >= 0 && at < figures.length) {
        current = at;
        reflect(host);
      }
    });
  });
  // A swipe or a drag is someone choosing: follow them, and let them look.
  for (const kind of ["pointerdown", "wheel", "touchstart"]) {
    slides.addEventListener(
      kind,
      () => {
        steeringUntil = 0;
        heldUntil = Date.now() + HOLD_AFTER_INTERACTION_MS;
      },
      {passive: true}
    );
  }
  slides.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    heldUntil = Date.now() + HOLD_AFTER_INTERACTION_MS;
    go(host, current + (event.key === "ArrowRight" ? 1 : -1), true);
  });
  show.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>("button");
    if (!button) return;
    heldUntil = Date.now() + HOLD_AFTER_INTERACTION_MS;
    if (button.dataset.step) go(host, current + Number(button.dataset.step), true);
    else if (button.dataset.slide) go(host, Number(button.dataset.slide), true);
  });
  show.addEventListener("pointerenter", () => (hovering = true));
  show.addEventListener("pointerleave", () => (hovering = false));
  hovering = show.matches(":hover");

  if (!resizeBound) {
    // A resize changes the slide width, so line the current slide up again.
    window.addEventListener("resize", () => go(document, current, false));
    resizeBound = true;
  }

  if (timer === undefined) {
    timer = window.setInterval(() => {
      const live = parts(document);
      if (!live || document.hidden || hovering || reducedMotion() || Date.now() < heldUntil) return;
      if (live.show.contains(document.activeElement)) return;
      go(document, current + 1, true);
    }, ADVANCE_MS);
  }
}
