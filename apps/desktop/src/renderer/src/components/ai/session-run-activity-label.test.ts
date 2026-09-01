import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SessionRunActivityLabel } from "./session-run-activity-label";

test("keeps one live-region label while visual activity stays hidden", () => {
  const html = renderToStaticMarkup(
    createElement(SessionRunActivityLabel, {
      live: true,
      nextActivity: {
        key: "running-command",
        label: "Running a command",
        active: true,
      },
      reduceMotion: false,
    }),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
  assert.match(html, /radius-thinking-label/);
  assert.match(html, /Deleting project files/);
  assert.match(html, /aria-hidden="true"/);
});

test("renders waiting activity without the working shimmer", () => {
  const html = renderToStaticMarkup(
    createElement(SessionRunActivityLabel, {
      live: true,
      nextActivity: {
        key: "run-state-waiting_for_approval",
        label: "Waiting for approval",
        active: false,
      },
      reduceMotion: false,
    }),
  );

  assert.match(html, /Waiting for approval/);
  assert.match(html, /text-muted-foreground/);
  assert.doesNotMatch(html, /radius-thinking-label/);
});

test("removes movement and blur from the reduced-motion entry state", () => {
  const html = renderToStaticMarkup(
    createElement(SessionRunActivityLabel, {
      live: true,
      nextActivity: {
        key: "thinking",
        label: "Thinking",
        active: true,
      },
      reduceMotion: true,
    }),
  );

  assert.doesNotMatch(html, /translateY\(2px\)/);
  assert.doesNotMatch(html, /blur\(1\.5px\)/);
});
