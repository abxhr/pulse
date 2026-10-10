export function routeFromHash(hash, validRoutes, fallback = "dashboard") {
  const value = String(hash || "").replace(/^#\/?/, "");
  return validRoutes.includes(value) ? value : fallback;
}

export function hashForRoute(route) {
  return `#/${route}`;
}
