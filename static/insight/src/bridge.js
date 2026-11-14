/**
 * Tells the page around this scene (the Mission Echoes site) what is happening, so it can
 * play the narration, record reel moments and open the challenge when the story ends.
 * Events: "begin" (Mars opens), "mission-start" and "mission-end" with { id }.
 * Opened on its own (not inside the site), this does nothing.
 */
export function tell(event, data = {}) {
  if (window.parent === window) return;
  window.parent.postMessage({ type: 'insight-scene', event, ...data }, location.origin);
}
