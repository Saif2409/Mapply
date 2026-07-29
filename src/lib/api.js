const BASE =
  window.location.protocol === "file:" ? "http://127.0.0.1:8710" : "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connection refused on a read — the backend is still booting, not broken.
 *  Only reads are retried: a failed connect means the request never landed,
 *  but we still don't want to gamble on replaying a POST/PATCH. */
async function fetchWithBoot(url, options, attempts = 24) {
  const method = (options.method || "GET").toUpperCase();
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (method !== "GET" || i >= attempts) throw e;
      await sleep(500);
    }
  }
}

async function request(path, options = {}) {
  const res = await fetchWithBoot(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  health: () => request("/api/health"),
  profiles: () => request("/api/profiles"),
  createProfile: (name) =>
    request("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  master: (name) => request(`/api/profiles/${encodeURIComponent(name)}/master`),
  jobs: (name) => request(`/api/profiles/${encodeURIComponent(name)}/jobs`),
  jobsRevision: (name) =>
    request(`/api/profiles/${encodeURIComponent(name)}/jobs/revision`),
  dismissJobs: (name, ids, restore = false) =>
    request(`/api/profiles/${encodeURIComponent(name)}/jobs/dismiss`, {
      method: "POST",
      body: JSON.stringify({ ids, restore }),
    }),
  patchJob: (name, jid, patch) =>
    request(`/api/profiles/${encodeURIComponent(name)}/jobs/${jid}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  startScan: (name) =>
    request(`/api/profiles/${encodeURIComponent(name)}/scan`, { method: "POST" }),
  scanStatus: (name) => request(`/api/profiles/${encodeURIComponent(name)}/scan`),
  startScoring: (name, body = { only_unscored: true }) =>
    request(`/api/profiles/${encodeURIComponent(name)}/score`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  scoreStatus: (name) => request(`/api/profiles/${encodeURIComponent(name)}/score`),
  models: () => request("/api/models"),
  profileFile: (name, filename) =>
    request(`/api/profiles/${encodeURIComponent(name)}/file/${filename}`),
  saveProfileFile: (name, filename, content) =>
    request(`/api/profiles/${encodeURIComponent(name)}/file/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  jobFiles: (name, jid) =>
    request(`/api/profiles/${encodeURIComponent(name)}/jobs/${jid}/files`),
  // Raw text of a generated file (outreach.md, cover_letter.md) rather than JSON.
  jobFileText: async (name, jid, filename) => {
    const res = await fetch(
      `${BASE}/api/profiles/${encodeURIComponent(name)}/jobs/${jid}/files/${encodeURIComponent(filename)}`
    );
    if (!res.ok) throw new Error(`Couldn't read ${filename}`);
    return res.text();
  },
  fileUrl: (name, jid, filename, download = false) =>
    `${BASE}/api/profiles/${encodeURIComponent(name)}/jobs/${jid}/files/${encodeURIComponent(filename)}${download ? "?download=true" : ""}`,
  hiringManager: (name, jid) =>
    request(`/api/profiles/${encodeURIComponent(name)}/jobs/${jid}/hiring-manager`),
  saveHiringManager: (name, jid, contact) =>
    request(`/api/profiles/${encodeURIComponent(name)}/jobs/${jid}/hiring-manager`, {
      method: "POST",
      body: JSON.stringify(contact),
    }),
  autofill: (name) => request(`/api/profiles/${encodeURIComponent(name)}/autofill`),
  criteria: (name) => request(`/api/profiles/${encodeURIComponent(name)}/criteria`),
  watchlist: (name) => request(`/api/profiles/${encodeURIComponent(name)}/watchlist`),
};

export function openExternal(url) {
  // `mapply` is the preload bridge; `sapply` kept so an older packaged build
  // still works if it loads a newer renderer during development.
  const bridge = window.mapply ?? window.sapply;
  if (bridge?.openExternal) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
