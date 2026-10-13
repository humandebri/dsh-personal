---
kind: reference
---

# Personal local DSH setup

English | [中文](README.zh.md)

## Summary

This directory preserves the credential-free local configuration for Apple Silicon macOS. Source revisions and runtime versions live in [versions.json](versions.json); generated binaries, Claude authentication and the full web profile remain outside Git.

## Table of Contents

- [Restore files](#restore-files)
- [Rebuild components](#rebuild-components)
- [Profile configuration](#profile-configuration)
- [Verification](#verification)
- [Dev Note](#dev-note)

## Restore files

Use a layout with sibling `core`, `runtime` and `local-codex-preset` directories. Run the helper from the core checkout; it previews eight files by default. `--apply` creates missing files and refuses any differing existing file before writing. Existing matching files retain their permissions.

```sh
python3 scripts/local-dsh/restore.py
python3 scripts/local-dsh/restore.py --apply
```

`--root /path/to/DSH` chooses a different layout root. The snapshot contains the Claude wrapper and login command, locked native Claude package dependencies, custom preset and a generated profile overlay. Copying files does not install dependencies or authenticate an account.

## Rebuild components

The manifest pins the personal core branch, personal Claude plugin commit and upstream rustdsh commit. Clone the plugin into `runtime/dsh-claude-plugin` and rustdsh into `runtime/rustdsh`; check out the exact manifest revisions. Install Node at `runtime/bin/node` using the recorded version, or create a link to that installed version. Rebuild the core checkout before building the linked plugin dependencies.

| Component | Build command in its directory | Output or next step |
| --- | --- | --- |
| core | `pnpm install --frozen-lockfile`, then `pnpm run build` | CLI, package libraries and web assets |
| runtime/rustdsh | `cargo build --release --locked` | Copy `target/release/rdsh` to `runtime/bin/rdsh`; link `runtime/bin/dsh` to `rdsh` |
| runtime/claude-runtime | `pnpm install --frozen-lockfile` | Official native Claude executable used by the wrapper |
| runtime/dsh-claude-plugin | `pnpm install --frozen-lockfile`, then `pnpm run build` | Local Claude provider libraries |

The core launcher delegates to rustdsh and keeps the Node fallback in `scripts/launch-local-dsh.node.sh`. It defaults to `RDSH_AUTH_AUTOSYNC=0` and `RDSH_PASSTHROUGH=1`. The SDK and native CLI versions differ; the live protocol probe passed, but upgrades require repeating that probe. A full rebuild on a fresh machine has not been verified.

For the native app, follow [macOS Web launcher](../../apps/macos-web-launcher/README.md). Point `/Applications/.dsh` to this core checkout's `scripts/launch-local-dsh.sh`. Build into a fresh app path and preserve the previous app before replacement. Restoring source files does not replace an installed app or restart an active server.

## Profile configuration

The custom preset declares its DSH bundle in [package.json](files/local-codex-preset/package.json). The Claude model provider and core Claude subagent also declare bundles. Install the corresponding local links in the web profile with the CLI's `plugin --profile web add` operation. The manifest records all five local bundles using paths relative to the layout root, including Codex and automatic review. The current profile uses legacy absolute links for the latter two; restore them from the matching core packages instead. Preserve other existing profile layers.

Merge the entries from generated `runtime/claude-profile.overlay.yml` into the existing profile patch by ID. Do not replace the entire profile. The Claude provider uses the absolute wrapper path and defaults to `claude-opus-5-5`; the Claude subagent uses the previously approved `acceptEdits` mode. The preset enables the Claude subagent tool. Selecting Claude Code in the model menu uses the provider; requesting delegation uses the subagent.

Run `runtime/login-claude.command` to authenticate the subscription account locally. Login data, web startup tokens and other providers' credentials must be restored separately using their own login procedures. The preset snapshot points to the skill directory recorded in the manifest; restore its contents separately and update the absolute directory when moving to another account.

## Verification

The plugin passes typecheck, build, lint and 192 tests. The authenticated live probe handles new user instructions after tool results, including a 285,009-byte tool result. Completed tool calls can replay after restart; incomplete calls fail explicitly to avoid repeating unknown effects. The plugin has no separate replay byte cap, while model context limits still apply.

The native launcher tests cover both `/` and `./` authentication redirects. The restoration helper has been checked for a fresh layout, repeat application and refusal to overwrite an existing differing file. These checks do not validate a clean-machine installation or authentication migration.

## Dev Note

Keep the manifest and snapshots together when changing local versions. Commit only these selected files: the full home profile can contain credentials and must never be copied here. Updating code on disk takes effect in the web server after a safe restart with no active work.
