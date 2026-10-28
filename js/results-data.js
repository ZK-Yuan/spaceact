let pending = null;

/** data/results.json (refreshed on the server every 15 minutes), fetched once per page; null if unavailable. */
export function loadResults() {
  if (!pending) {
    pending = fetch("data/results.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return pending;
}

/** Every model's row on one instance, or null. */
export async function caseRows(task) {
  const d = await loadResults();
  return (d && d.cases && d.cases[task]) || null;
}
