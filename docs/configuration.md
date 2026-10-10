# Configuration reference

Everything is configured through environment variables (a `.env` in the working directory is loaded automatically). Back to the [README](../README.md).

## Environment variables

| Env var | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✓ | OAuth **Desktop** client from Google Cloud — see [Google Cloud setup](./google-cloud-setup.md) |
| `GOOGLE_ACCOUNTS` | ✓ | `alias:email,…` — e.g. `work:you@co.com,personal:you@gmail.com` |
| `MASTER_KEY` | ✓ | base64 32-byte key that encrypts the token store (`openssl rand -base64 32`) |
| `GOOGLE_PROFILE` | — | write policy: `read-only` (default) · `safe-writes` · `full-writes` |
| `GOOGLE_READ_ONLY` | — | `true` = hard kill-switch for all writes |
| `GOOGLE_WRITE_ALLOW` / `GOOGLE_WRITE_DENY` | — | glob overrides, e.g. `calendar:*`, `*:delete*` (deny wins) |
| `GOOGLE_OPTIONAL_SCOPES` | — | opt-in scope bundles, CSV — see [bundles](#optional-scope-bundles) |
| `GOOGLE_ADMIN_ACCOUNTS` | — | aliases granted Workspace-admin scopes (the account's own super-admin OAuth) |
| `GOOGLE_TOOLSETS` | — | `all` (default) or a CSV filter of service names — see [services](#services) |
| `GOOGLE_ALWAYS_EXPOSE` | — | CSV of tool names listed from boot, without a `{service}_discover` call — for clients that ignore `tools/list_changed` (e.g. Claude Cowork). See [always-exposed tools](#always-exposed-tools) |
| `TOKEN_STORE_PATH` | — | override the encrypted token dir (default: `$XDG_CONFIG_HOME/mcp-google-multi/tokens`, falling back to `~/.config/mcp-google-multi/tokens`) |
| `DISCOVERY_CACHE_PATH` | — | override the Discovery-doc cache dir (default: `$XDG_CONFIG_HOME/mcp-google-multi/discovery`, falling back to `~/.config/mcp-google-multi/discovery`) |
| `GOOGLE_TRIM` | — | `off` (or `0`/`false`/`no`) disables compact JSON serialization of tool responses |

Inspect the resolved setup any time: `mcp-google-multi config check`.

## Write-control (deny-by-default)

Reads are never gated. **Every create/update/delete is off until you opt in** — pick a profile:

| `GOOGLE_PROFILE` | Allows |
|---|---|
| `read-only` (default) | reads only |
| `safe-writes` | create + update (deletes still blocked) |
| `full-writes` | everything |

`GOOGLE_READ_ONLY=true` overrides all. For fine control: `GOOGLE_WRITE_ALLOW="calendar:*, sheets:update*"` and `GOOGLE_WRITE_DENY="*:delete*"` (deny wins). The policy applies identically to curated tools, generated tools, and the escape hatch.

### Recipe: Drive uploads with recoverable trash, no sharing

Allows creating/uploading files and moving them to/from the trash; keeps permanent delete, empty-trash, `drive_transfer` with `move=true`, and every sharing/permission change blocked — including through `google_api_call`:

```bash
GOOGLE_PROFILE=safe-writes
GOOGLE_WRITE_ALLOW=drive:trash,drive:untrash
GOOGLE_WRITE_DENY=drive:share,drive:permission_update,drive:remove_permission,drive:permissions_*
```

Why the deny list: `safe-writes` allows every create/update, and `drive_share` is a *create*, `drive_permission_update` an *update*. Don't deny `drive:delete` to block permanent deletes — that glob also matches the `delete` class `drive_trash` belongs to; `safe-writes` already blocks deletes, and `drive:trash` opens only that one.

Escape-hatch methods are matched by `<service>:<cud>`, `<service>:<method>` (e.g. `drive:create`) **and** `<service>:<resource>_<method>` (e.g. `drive:permissions_create`, `drive:files_create`), so a glob can tell sharing apart from file creation.

The policy is server-wide: it applies to every account configured in that server instance.

## Always-exposed tools

Discover-first listing relies on the client re-fetching `tools/list` after `notifications/tools/list_changed`. Clients that don't (Claude Cowork at the time of writing) never see the tools a `{service}_discover` call reveals. Pin the ones you need so they are listed from boot:

```bash
GOOGLE_ALWAYS_EXPOSE=drive_search,drive_list,drive_upload,drive_trash,drive_untrash
```

Exact tool names, CSV. Unknown names are ignored with a warning on stderr. Everything else keeps the discover-first behavior. Pinning only affects listing; write-control still decides whether a write runs.

## Services

Core services register by default: `gmail`, `drive`, `calendar`, `sheets`, `docs`, `contacts`, `searchconsole`, `tasks`, `meet`, `workspaceevents`.

Optional services register when their bundle is enabled (below): `slides`, `forms`, `chat`, `classroom`, `cloudidentity`, `cloudsearch`, `vault`, `keep`, `driveactivity`, `drivelabels`, `script`, `postmaster`, `groupssettings`, `groupsmigration`, `licensing`, `reseller`, `appsmarket` — plus `admin`, which requires `GOOGLE_ADMIN_ACCOUNTS`.

`GOOGLE_TOOLSETS` is a filter only: listing an optional service does not enable it without its bundle/admin gate.

## Optional scope bundles

Add bundle names to `GOOGLE_OPTIONAL_SCOPES` (CSV), then re-run `auth` for each account so the new scopes are granted:

`slides`, `forms`, `chat`, `classroom`, `cloudidentity`, `cloudsearch`, `vault`, `keep`, `driveactivity`, `drivelabels`, `script`, `postmaster`, `groupssettings`, `groupsmigration`, `licensing`, `reseller`, `appsmarket`.

Two bundles extend the always-on `gmail` service instead of enabling a new one — Gmail settings **writes** only accept the dedicated settings scopes (reads already work with the base scope):

| Bundle | Scope | Unlocks |
|---|---|---|
| `gmail_settings` | `gmail.settings.basic` | writing filters, vacation responder, IMAP/POP, language |
| `gmail_settings_sharing` | `gmail.settings.sharing` | send-as, delegates, auto-forwarding — kept separate because it can redirect or delegate your mail |

A tool whose scope was never granted returns a typed `insufficient_scope` error with a re-auth hint instead of failing silently.

## Secrets management

Don't leave `GOOGLE_CLIENT_SECRET` + `MASTER_KEY` in a plaintext `.env` for daily use — inject them at launch from a secrets manager. See [Secrets in a vault](./secrets.md).
