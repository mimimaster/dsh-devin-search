# pi-devin-search

Native [pi](https://pi.dev) CLI extension for Devin web search and read-only local code search. It does not include a desktop or React UI and does not depend on DeepSeek Harness.

Tested host: `@earendil-works/pi-coding-agent@1.0.3` and `@earendil-works/pi-ai@1.0.3`. Pi supplies those packages and `typebox@1.3.27`; this package lists them as exact peers and does not bundle them. `ignore@7.0.5` is a runtime dependency. The published `dist/extension.js` bundles the search and OAuth core and contains no DSH runtime.

```bash
pi install ./packages/pi-devin-search
# or, after publish: pi install npm:pi-devin-search@0.1.0
```

## Commands

- `/devin-login` starts PKCE code login. `/devin-login local` uses an optional localhost callback.
- `/devin-status` shows login state without credentials.
- `/devin-logout` cancels in-flight work and deletes the stored session.
- `/devin-cancel` cancels a pending login.
- `/devin-settings` with no arguments opens a selector. `/devin-settings web|code on|off` changes one switch.

Do not paste an authorization code into a slash argument. The command rejects anything other than empty or `local` and does not echo the argument. The code prompt uses `ctx.ui.input`. That input is ordinary visible text, not a masked field. Noninteractive print/JSON login is refused. Status uses `ctx.ui.notify` and `setStatus` only, so it does not write tokens to stdout.

Tools `web_search` and `code_search` are registered at `session_start` after `getAllTools()`. A name already owned by another extension is left unchanged. Both tools are annotated read-only with `openWorldHint: true` because queries and selected code are sent to the Devin cloud. Disabling a tool in settings is enforced inside `execute`, not only by removing it from the active set.

## Credentials

Sessions are stored at `<getAgentDir()>/devin-search/credentials.json`. Temporary writes use `credential-*.tmp`. This package does not read pi `auth.json`, DSH credentials, or project `.pi` trees. There is no cross-process writer lock: in-process writes are serialized, and `rename` is atomic, but two processes can lose updates. Do not share one credential file across processes.

POSIX mode bits 0700/0600 are applied. They are not an equivalent confidentiality boundary on Windows. After rename, POSIX directory fsync is skipped on Windows so a successful rename is not failed by a POSIX-only directory open. Windows filesystem behavior was not validated in this environment. There is no ACL or keychain store.

Settings are independent booleans in `devin-search/settings.json`. They are not secrets.
