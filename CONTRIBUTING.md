# Contributing to Dissent Plugins

## Creating a Community Plugin

You don't need to submit here to create a Dissent plugin. Host your plugin anywhere and submit it to the [Dissent Plugin Marketplace](https://plugins.dissent.chat/submit).

To contribute an official plugin to this repo, open a PR with:

```
plugins/<your-plugin-id>/
├── plugin.html       # Your plugin (self-contained HTML)
├── manifest.json     # Metadata (see below)
└── README.md         # Description + config + permissions
```

## manifest.json required fields

```json
{
  "id": "unique-kebab-case-id",
  "name": "Display Name",
  "version": "1.0.0",
  "description": "One sentence.",
  "author": "Your Name",
  "public_key": "ed25519:<64-hex-chars>",
  "tier": 1,
  "context": ["channel"],
  "url": "https://plugins.dissent.chat/plugins/<your-plugin-id>/plugin.html",
  "declared_permissions": [],
  "allowed_fetch_domains": [],
  "config_schema": null,
  "categories": [],
  "sdk_version": "1"
}
```

## Tiers

| Tier | Permissions |
|---|---|
| 1 | Passive — no sensitive permissions |
| 2 | Interactive — can read profile + channel data |
| 3 | Activity — full permissions (storage, realtime, identity) |

## Testing your plugin locally

Point the plugin iframe at `localhost` by installing it via the "Install by URL" feature in Server Settings → Plugins. Your manifest.json must be reachable at the URL you provide.

## SDK

The Dissent Plugin SDK is available at:

```
https://plugins.dissent.chat/sdk/v1/dissent-plugin-sdk.js
```

Source: `sdk/v1/dissent-plugin-sdk.js` in this repo.
