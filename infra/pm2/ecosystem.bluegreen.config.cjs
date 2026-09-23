function app(name, filter, portKey, port, apiPort) {
  return {
    name,
    cwd: "/var/www/petitannonces/current",
    script: "pnpm",
    args: `--filter ${filter} start`,
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    max_memory_restart: "1200M",
    kill_timeout: 10000,
    env: { NODE_ENV: "production", [portKey]: String(port), PORT: String(port), API_PORT: String(port), ...(apiPort ? { API_INTERNAL_URL: `http://127.0.0.1:${apiPort}` } : {}), REQUIRE_REDIS_READY: "true" },
  };
}
module.exports = { apps: [
  app("pa-web-blue", "@pa/web", "PORT", 3000, 4000),
  app("pa-admin-blue", "@pa/admin", "PORT", 3001, 4000),
  app("pa-api-blue", "@pa/api", "API_PORT", 4000),
  app("pa-web-green", "@pa/web", "PORT", 3100, 4100),
  app("pa-admin-green", "@pa/admin", "PORT", 3101, 4100),
  app("pa-api-green", "@pa/api", "API_PORT", 4100),
]};
