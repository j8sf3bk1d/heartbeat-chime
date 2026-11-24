let presetLabel = (id) => id;
let schedulerRuntime = null;

export function updateOverview(state, getPresetLabel, runtime) {
  if (getPresetLabel) presetLabel = getPresetLabel;
  if (runtime) schedulerRuntime = runtime;
  const audioUnavailable = state.running && schedulerRuntime?.audioReady === false;
  const enabled = state.intervals.filter((interval) => interval.enabled);
  document.getElementById("overview-count").textContent = enabled.length ? `${enabled.length} recurring chime${enabled.length === 1 ? "" : "s"} enabled` : "No recurring chimes enabled";
  document.getElementById("overview-heading").textContent = audioUnavailable ? "Audio unavailable" : state.running ? (enabled.length ? "Chimes are active" : "Scheduler is running") : "Chimes are paused";
  document.getElementById("overview-message").textContent = audioUnavailable
    ? "The scheduler is running, but audio is unavailable."
    : state.running
    ? "Scheduler is running. Keep Heartbeat open to hear your cues."
    : enabled.length ? "Your timing is saved. Start chimes when you’re ready." : "Choose your timing and sounds to get started.";
  const list = document.getElementById("overview-intervals");
  list.replaceChildren();
  if (!enabled.length) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = "No chimes enabled yet. Choose an interval to get started.";
    list.append(empty);
  }
  for (const interval of enabled) {
    const row = document.createElement("div");
    row.className = "overview-interval";
    const icon = document.createElement("span"); icon.className = "chime-dot"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "✓";
    const details = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = interval.label;
    const description = document.createElement("small"); description.textContent = `Sound: ${presetLabel(interval.presetId)}`;
    details.append(title, description); row.append(icon, details); list.append(row);
  }
}

const VIEWS = new Set(["overview", "chimes", "sounds", "timers", "settings"]);
const LEGACY_LINKS = {
  "chime-controls": "overview",
  "recurring-chimes": "chimes",
  "sound-library": "sounds",
  "quick-timers": "timers"
};

export function initializeNavigation({ state }) {
  const sections = [...document.querySelectorAll("[data-view]")];
  const links = [...document.querySelectorAll("[data-view-link]")];
  function showView(view, { focus = false } = {}) {
    const selected = VIEWS.has(view) ? view : "overview";
    for (const section of sections) section.hidden = section.dataset.view !== selected;
    for (const link of links) {
      if (link.closest(".app-navigation") && link.dataset.viewLink === selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    updateOverview(state);
    const titles = { overview: ["Overview", "Set up and run your recurring chimes."], chimes: ["Chimes", "Choose when and how your chimes sound."], sounds: ["Sounds", "Import and explore your sound library."], timers: ["Timers", "Set a one-time reminder."], settings: ["Settings", "Adjust Heartbeat to suit you."] };
    document.getElementById("view-title").textContent = titles[selected][0];
    document.getElementById("view-subtitle").textContent = titles[selected][1];
    if (focus) {
      const heading = sections.find((section) => !section.hidden)?.querySelector("h2");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function routeFromLocation() {
    const hash = window.location.hash.slice(1);
    showView(LEGACY_LINKS[hash] || hash);
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-view-link]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const view = link.dataset.viewLink;
    if (!VIEWS.has(view)) return;
    if (window.location.hash !== `#${view}`) window.history.pushState(null, "", `#${view}`);
    showView(view, { focus: true });
  });
  window.addEventListener("popstate", routeFromLocation);
  window.addEventListener("hashchange", routeFromLocation);
  routeFromLocation();
}
