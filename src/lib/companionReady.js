// The native window waits for this barrier before its first non-activating show.
// Registering the event listener alone does not guarantee WebKit finished load.
export function whenDocumentLoaded(doc = document, target = window) {
  if (doc.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => target.addEventListener("load", resolve, { once: true }));
}
