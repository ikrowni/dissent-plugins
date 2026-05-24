let i = null, a = null;
const c = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map();
let o = 0;
function m() {
  return `dissent-${++o}-${Date.now()}`;
}
function s(e, t) {
  return new Promise((n, r) => {
    const d = m();
    c.set(d, { resolve: n, reject: r });
    const u = { type: "dissent:request", id: d, action: e, params: t };
    window.parent.postMessage(u, "*"), setTimeout(() => {
      c.has(d) && (c.delete(d), r(new Error(`Dissent SDK: request "${e}" timed out`)));
    }, 1e4);
  });
}
function w(e) {
  var t;
  return {
    server: { id: e.context.serverId, name: e.context.serverName },
    channel: e.context.channelId ? { id: e.context.channelId, name: e.context.channelName } : void 0,
    user: e.user,
    config: e.context.pluginConfig,
    theme: e.theme,
    permissions: ((t = e.user) == null ? void 0 : t.permissions) ?? []
  };
}
window.addEventListener("message", (e) => {
  const t = e.data;
  if (t != null && t.type) {
    if (t.type === "dissent:init") {
      a = w(t), i == null || i(a), i = null;
      return;
    }
    if (t.type === "dissent:response") {
      const n = t, r = c.get(n.id);
      if (!r) return;
      c.delete(n.id), n.ok ? r.resolve(n.data ?? null) : r.reject(new Error(n.error ?? "Request failed"));
      return;
    }
    if (t.type === "dissent:event") {
      const n = t;
      if ((l.get(n.event) ?? []).forEach((r) => r(n.data)), n.event === "command:invoked") {
        const { command: r, args: d } = n.data, u = f.get(r);
        u && Promise.resolve(u(d ?? "")).then((h) => {
          s("embed:render", { payload: h }).catch(() => {
          });
        });
      }
      return;
    }
    t.type === "dissent:theme-update" && (a && (a = { ...a, theme: t.theme }), (l.get("theme:change") ?? []).forEach((n) => n(t.theme)));
  }
});
const v = {
  /**
   * Initialize the plugin. Resolves with PluginContext once the host sends dissent:init.
   * If no init is received within 3s, fires options.onFallback (plugin running outside Dissent).
   */
  init(e) {
    return a ? Promise.resolve(a) : new Promise((t) => {
      i = t, setTimeout(() => {
        var n;
        a || (n = e == null ? void 0 : e.onFallback) == null || n.call(e);
      }, 3e3);
    });
  },
  /** Returns the current PluginContext synchronously, or null if not yet initialized. */
  getContext() {
    return a;
  },
  /** Fetch messages from the current channel. Requires channel:read permission. */
  async getMessages(e) {
    return await s("channel:read", { limit: (e == null ? void 0 : e.limit) ?? 50, before: e == null ? void 0 : e.before }) ?? [];
  },
  /**
   * Get the current user's profile. Returns null if profile:read was not granted.
   * For profile-context plugins, the profile owner's data is in ctx.user automatically.
   */
  async getUser() {
    return await s("profile:read") ?? null;
  },
  /**
   * Fetch an external URL via the dissent-core proxy.
   * Requires fetch:external permission. The user's IP is never exposed to the target server.
   */
  async fetch(e, t) {
    return await s("fetch:external", {
      url: e,
      method: (t == null ? void 0 : t.method) ?? "GET",
      body: t == null ? void 0 : t.body
    });
  },
  /**
   * Subscribe to a real-time event.
   * Supported events: 'message:new', 'message:deleted', 'member:join', 'member:leave', 'theme:change'
   */
  on(e, t) {
    const n = l.get(e) ?? [];
    n.push(t), l.set(e, n), s("events:subscribe", { events: [e] }).catch(() => {
    });
  },
  /**
   * Post a message to the channel as the plugin bot. Requires bot:post (Tier 3) permission.
   */
  async postMessage(e) {
    await s("bot:post", { content: e });
  },
  /**
   * Register a slash command handler. When a user types /command in this channel,
   * the handler is invoked with any arguments and should return an EmbedPayload.
   * Requires Tier 3 permission.
   */
  onCommand(e, t) {
    e.startsWith("/") || (e = "/" + e), f.set(e, t), s("command:register", { command: e }).catch(() => {
    });
  }
};
typeof window < "u" && (window.Dissent = v);
export {
  v as default
};
