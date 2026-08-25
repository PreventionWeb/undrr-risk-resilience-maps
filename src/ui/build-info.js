/* global __APP_LAST_UPDATED__, __APP_COMMIT_HASH__ */

const REPOSITORY_URL = "https://github.com/unisdr/undrr-risk-resilience-maps";

const UNITS = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

export function formatRelativeTime(date, now = new Date()) {
  const elapsedSeconds = (date.getTime() - now.getTime()) / 1000;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, seconds] of UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      return formatter.format(Math.round(elapsedSeconds / seconds), unit);
    }
  }

  return "just now";
}

export function initBuildInfo({
  timestamp = __APP_LAST_UPDATED__,
  commitHash = __APP_COMMIT_HASH__,
  now = () => new Date(),
} = {}) {
  const time = document.getElementById("build-updated-at");
  const link = document.getElementById("build-info-link");
  const updatedAt = new Date(timestamp);

  if (!time || !link || Number.isNaN(updatedAt.getTime())) return undefined;

  time.dateTime = updatedAt.toISOString();
  link.href = REPOSITORY_URL;
  link.title = `Last code update: ${updatedAt.toLocaleString()} (${commitHash})`;

  const updateRelativeTime = () => {
    time.textContent = `Updated ${formatRelativeTime(updatedAt, now())}`;
  };

  updateRelativeTime();
  const intervalId = window.setInterval(updateRelativeTime, 60_000);
  return () => window.clearInterval(intervalId);
}
