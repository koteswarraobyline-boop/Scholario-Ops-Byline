# Task 02 — Database and dependency model assessment

**Status:** Approved and applied on 16 Nov 2026. The dev server was restarted from this tree. The log recorded `applied migrations: 017_dependency_mvp.sql` and then `ready — database loaded`. `schema_migrations` contains `017_dependency_mvp.sql`. `dependency_links` now has `method` and `updated_at`. The link count is still 0. The nine application ids and fifteen server ids, including each production and disaster-recovery link, match the snapshot taken before the restart. No dependency row was inserted.

The configured database is local PostgreSQL `scholario_ops_dev`, schema `ops`, role `scholario_ops`. It is not a remote production host. Production and disaster recovery in this note are the `servers.environment` values `PRD` and `DR`.

`server/store.ts` reads and writes the new columns. A later start of this tree finds `017` already applied and skips it. Removing the file from `schema_migrations` without removing the columns would make the runner try to add them again. The SQL is written so that repeat is safe (`IF NOT EXISTS`). A copy of the SQL remains at `docs/proposals/017_dependency_mvp.sql`.

---

## 0. Records read from `scholario_ops_dev`

Counts after apply: 9 applications, 15 servers, 11 monitors, 9 registry components, 0 dependency links. Incidents were counted before the restart and not opened: 22 `OPEN`, 9 `CLOSED`, 47 `RESOLVED`. `schema_migrations` contains `001_init.sql` through `017_dependency_mvp.sql`.

### Hosting is not a dependency

Every server is referenced by exactly one application, as `prd_server_id` or `dr_server_id`. No server is unattached. Hostinger is the provider on every server. That pair of columns is the hosting relationship. It must not be copied into `dependency_links`.

| Application | Id | Tier | Status | PRD hostname | DR hostname |
|---|---|---|---|---|---|
| ICT (Cipher LMS) | `62489948-c776-4048-8525-50332f0d4892` | TIER_1 | HEALTHY | `93.127.167.135` | `187.126.113.32` |
| QR Videos | `42cb0410-9e07-4955-9394-405dd7293076` | TIER_2 | HEALTHY | `qr.videos.prd` | `qr.videos.dr` |
| Scholario Social LMS | `650a37ce-39d6-4d68-8d66-98ee4e0e975c` | TIER_2 | UNKNOWN | `scholario.social.lms.prd` | `scholario.social.lms.dr` |
| Scholario Ascend | `36c72a65-ab30-4321-9136-a714e86b2e17` | TIER_2 | UNKNOWN | `scholario.ascend.prd` | `scholario.ascend.dr` |
| Vantage | `711d6c51-e006-480b-a0cf-df041c4a3f4a` | TIER_2 | UNKNOWN | `vantage.prd` | `vantage.dr` |
| Scholario KG LMS | `6347fe16-8a34-4530-b769-415429e08246` | TIER_2 | UNKNOWN | `scholario.kg.lms.prd` | `scholario.kg.lms.dr` |
| LXP Portal | `75108dd3-e9fe-4fbb-9763-6f0e197d1077` | TIER_2 | UNKNOWN | `lxp.portal.vps` | none |
| Scholario Lumo | `107402a9-5f80-49de-8820-a8a88e2501af` | TIER_2 | UNKNOWN | `scholario.lumo.prd` | none |
| Scholario Websites | `0f6d97d2-7d06-4efe-bb20-f90d269c7c30` | TIER_2 | UNKNOWN | `scholario.websites` | none |

Server ids are in Task 01 section 5. ICT’s hostnames are the addresses stored in `servers.hostname`. All nine applications are `PRIMARY_ACTIVE` with automatic failover off. ICT RTO/RPO are 30/15 minutes. The others are 60/60.

### Monitoring status

Application status is the value stored in `applications.state`. It is not a column of its own.

| Application | What is stored |
|---|---|
| ICT (Cipher LMS) | `HEALTHY`. PRD: unmanaged HTTP `HEALTHY`, managed HTTPS `HEALTHY`, managed SSL `HEALTHY`. DR: unmanaged HTTP `HEALTHY`, managed HTTPS `CRITICAL`, managed SSL `HEALTHY`. Active environment is PRD, so the DR HTTPS failure does not change the application status. |
| QR Videos | `HEALTHY`. PRD: managed HTTPS and SSL `HEALTHY`. DR: managed HTTPS and SSL `CRITICAL`. Same active-environment rule. |
| The other seven | `UNKNOWN`. No monitor row. |

One monitor has a null application id: disabled HTTP, environment PRD, stored status `CRITICAL`. It was not changed.

Every server stores `agentStatus` `DISCONNECTED` and `status` `UNKNOWN`, and every server has `lastSeen`. `vpsOperationalStatus` would classify that as `STALE`. The stored server status and the function disagree. UNKNOWN is not DOWN. A disconnected agent does not set application status.

### How an application-to-application dependency will be stored

Not in a new table. The consumer and the provider are rows in `registry_components`. The relationship is one row in `dependency_links`: `from_id` is the consumer, `to_id` is the provider, `link_type` is `HARD` or `SOFT`.

The nine applications already have register components of kind `APPLICATION`, each with `application_id` set and `server_id` null. Their tiers match the application tiers (ICT `TIER_1`, the rest `TIER_2`). A dependency between two applications is a link between those two existing components. It is not a new application row and not a new register component.

A dependency on a database, storage system, third-party API, or provider is a new component of that kind, then a link. A dependency on a server that is only “this application runs on this VPS” is not a link. That fact stays on `prd_server_id` and `dr_server_id`.

`dependency_links` is empty. That is valid. It is not a finding that these applications have no dependencies. `src/mocks/dependencyDemoData.ts` is not a source of rows.

### Columns the live table has today

`id`, `from_id`, `to_id`, `link_type`, `feature_id`, `notes`, `created_at`. Constraints match migration 007/008: primary key, `from_id <> to_id`, `link_type` in `HARD`/`SOFT`, foreign keys to `registry_components`, and the deferred exclusion on `(from_id, to_id, feature)`. There is no `updated_at`. There is no `method`.

---

---

## 1. Existing schema assessment

PostgreSQL, schema name `DB_SCHEMA` (default `ops`). No ORM. `server/store.ts` loads these tables into memory and writes dirty rows back.

### `applications` (migration 001)

| Column | Constraint |
|---|---|
| `id` | uuid primary key |
| `name` | not null |
| `code_name` | not null, unique |
| `description` | not null, default `''` |
| `tier` | `TIER_1`, `TIER_2`, `TIER_3` |
| `rto_target_min` | integer > 0 |
| `rpo_target_min` | integer >= 0 |
| `prd_server_id` | uuid, FK → `servers(id)` `ON DELETE SET NULL`, deferrable |
| `dr_server_id` | uuid, FK → `servers(id)` `ON DELETE SET NULL`, deferrable |
| `prd_url`, `dr_url` | text, nullable |
| `cloudflare_zone` | not null, default `''` |
| `dns_record_name` | text |
| `auto_failover` | boolean, default false |
| `failover_state` | `PRIMARY_ACTIVE`, `DR_ACTIVE`, `FAILING_OVER` |
| `last_failover_at` | timestamptz |
| `hc_expected_status` | 100–599 or null |
| `hc_interval_sec` | >= 10, default 30 |
| `hc_timeout_sec` | >= 1, default 15 |
| `hc_ssl_monitoring` | boolean, default true |
| `created_at`, `updated_at` | timestamptz |
| `state` | jsonb, live status. Not configuration |

**Hosting** is `prd_server_id` and `dr_server_id`. That is “this application runs on these servers”. It is not a row in `dependency_links`.

### `servers` (migration 001)

| Column | Constraint |
|---|---|
| `id` | uuid primary key |
| `hostname` | not null, unique |
| `ip` | not null, unique |
| `environment` | `PRD` or `DR` |
| `application_id` | uuid, no FK in `001` |
| `provider`, `region`, `plan_name`, `notes` | text |
| `plan_cpu_cores`, `plan_ram_gb`, `plan_disk_gb` | positive or null |
| `plan_source` | `manual`, `config`, `hostinger`, or null |
| `agent_token` | not null. Never sent to the browser |
| `hostinger_vm_id`, `hostinger_state` | optional |
| `created_at`, `updated_at` | timestamptz |
| `state` | jsonb telemetry and agent status |

### `application_environments` (migration 003)

Primary key `(application_id, environment)`. `application_id` FK → `applications` `ON DELETE CASCADE`, deferrable. `environment` is `PRD` or `DR`.

Optional facts: `app_port`, `health_path`, `web_server`, `process_manager`, `routing`, `db_engine` (`mysql`, `mariadb`, `postgresql`), `db_name`, `db_port`, `replication_max_lag_sec`, `backup_max_age_hours`, `notes`, `updated_at`.

Null means not confirmed. `db_engine` tells the agent which database to probe on that environment’s server. It is not a service-dependency row. Do not copy it into `dependency_links`.

### `registry_components` (migration 007, uniqueness replaced in 008)

| Column | Constraint |
|---|---|
| `id` | uuid primary key |
| `kind` | `APPLICATION`, `SERVER`, `DATABASE`, `STORAGE`, `THIRD_PARTY_API`, `PROVIDER`, `BUSINESS_FEATURE` |
| `name` | not null, trimmed non-empty |
| `name_key` | not null. Application-computed fold of `name` (`server/registryName.ts`). Not `lower()` |
| `owner` | not null, trimmed non-empty |
| `tier` | `TIER_1`, `TIER_2`, `TIER_3` |
| `description` | not null, default `''` |
| `application_id` | FK → `applications` `ON DELETE SET NULL`, deferrable. Allowed only when kind is `APPLICATION` or `BUSINESS_FEATURE` |
| `server_id` | FK → `servers` `ON DELETE SET NULL`, deferrable. Allowed only when kind is `SERVER` |
| `user_count` | integer >= 0, or null. Audience kinds only |
| `served` | jsonb array. Non-empty only for audience kinds |
| `created_at`, `updated_at` | timestamptz, not null |

Uniqueness, all deferrable so one transaction can swap names:

- `UNIQUE (kind, name_key)` — `registry_components_name_key_uq`
- Exclude one `APPLICATION` row per `application_id` — `registry_components_app_excl`
- Exclude one `SERVER` row per `server_id` — `registry_components_server_excl`

Deleting an application or server sets the register pointer to null. The component row remains (`forgetRegistryReferences` does the same in memory).

### `dependency_links` (migration 007, uniqueness replaced in 008)

| Column | Constraint |
|---|---|
| `id` | uuid primary key |
| `from_id` | not null, FK → `registry_components` `ON DELETE CASCADE`, deferrable. The consumer: “from depends on to” |
| `to_id` | not null, FK → `registry_components` `ON DELETE CASCADE`, deferrable. The provider |
| `link_type` | `HARD` or `SOFT` |
| `feature_id` | nullable FK → `registry_components` `ON DELETE SET NULL`, deferrable. No database check that the target is `BUSINESS_FEATURE` |
| `notes` | text, not null, default `''`. API limit 500 characters |
| `created_at` | timestamptz, not null. **No `updated_at`** |
| check | `from_id <> to_id` |

Uniqueness: `dependency_links_excl` on `(from_id, to_id, coalesce(feature_id, zero-uuid))`, deferrable. One link per consumer, provider, and feature. A null feature counts as one value. Index `dependency_links_to_idx` on `to_id`.

Direction used by impact: failure walks from the provider (`to_id`) toward the consumer (`from_id`). A named feature is an extra hard edge from the provider to that feature, even when `link_type` is `SOFT` (`failureEdges` in `server/registry.ts`). This proposal does not change that rule.

### What `store.ts` persists today

`dependency_links` columns written and read: `id`, `from_id`, `to_id`, `link_type`, `feature_id`, `notes`, `created_at`.

`registry_components` columns: `id`, `kind`, `name`, `name_key`, `owner`, `tier`, `description`, `application_id`, `server_id`, `user_count`, `served`, `created_at`, `updated_at`.

Links are saved before components so a deleted component cannot leave a `feature_id` that collides with a remaining link.

`applications.prd_server_id` / `dr_server_id` and `application_environments` are saved on the application tables. A dependency save does not write them.

---

## 2. Missing fields and capabilities

| MVP need | Existing representation | Add a column? |
|---|---|---|
| 1. Consumer application | `from_id` → component. For kind `APPLICATION`, `application_id` is the existing application row. For a feature, the feature’s `application_id` is the application that provides it | No. A new consumer column would duplicate `from_id` |
| 2. Provider type | Provider component `kind` (`APPLICATION`, `SERVER`, `DATABASE`, `STORAGE`, `THIRD_PARTY_API`, `PROVIDER`, `BUSINESS_FEATURE`) | No |
| 3. Provider application or resource | `to_id`. An application provider uses that component’s `application_id`. A server provider uses `server_id`. A database or API is the component itself | No |
| 4. Provider name | Provider component `name` | No |
| 5. Affected feature or module | `feature_id`, which must be a `BUSINESS_FEATURE` in `buildLink`. The feature component has its own `name` | No |
| 6. HARD or SOFT | `link_type` | No |
| 7. Dependency method | Not stored. `notes` is the only free text, and item 9 needs that text for the rationale | **Yes. `method`, nullable** |
| 8. Failure behaviour | `link_type` is the behaviour the engine already applies: HARD stops the consumer, SOFT degrades it to `WARNING`. A second text column could disagree with `link_type` | No |
| 9. Business rationale | `notes` | No. Keep the API name `notes`. Document it as the rationale |
| 10. Created and updated timestamps | Components have both. Links have `created_at` only | **Yes. `updated_at` on `dependency_links`** |

No new table. Hosting stays on `applications`. `application_environments.db_engine` stays the probe hint.

`method` is one value per link. It is not added to the unique key. Two methods between the same consumer, provider, and feature remain one row. The operator picks the primary method. A second method would be a second feature or a later, separate decision to widen uniqueness.

---

## 3. Proposed schema changes

On `dependency_links` only:

- `method text` null, check `HTTP`, `API`, `DATABASE`, `EMBED`, `LINK`, `OTHER`.
- `updated_at timestamptz` not null. Existing rows (none are expected) would be set from `created_at`. Default `now()` so an insert that omits the column still succeeds.

Uniqueness, foreign keys, component name rules, link direction, and the feature-is-always-hard impact edge stay as they are.

---

## 4. Proposed migration

File already present: `server/migrations/017_dependency_mvp.sql`. The same statement text is kept at `docs/proposals/017_dependency_mvp.sql` so the proposal can be read without treating the migrations folder as the only copy.

It adds the two columns, adds the check constraint if missing, backfills `updated_at` from `created_at`, then sets `NOT NULL` and the default. It is safe to re-run (`IF NOT EXISTS`). It does not insert links and does not alter `applications` or `servers`. On this database the backfill updates zero rows.

**Applied.** On 16 Nov 2026 the dev server was restarted from this tree and the log recorded `applied migrations: 017_dependency_mvp.sql`. The columns are in `scholario_ops_dev`. Do not point an older build, one whose `store.ts` omits the columns, at this database.

**Rollback.** The runner does not roll back applied files. Manual rollback, only before a server has saved links with the new columns:

```sql
ALTER TABLE ops.dependency_links DROP COLUMN IF EXISTS method;
ALTER TABLE ops.dependency_links DROP COLUMN IF EXISTS updated_at;
```

Replace `ops` with `DB_SCHEMA` if it is not `ops`. Dropping the columns discards method and updated time. It does not delete links or hosting rows. Delete the `schema_migrations` row for this file only if the file must be applied again later. Do not do that as part of this task.

**Compatibility.** The running dev server is the build that applied `017` and then loaded `method` and `updated_at`. Do not point an older build, one whose `store.ts` omits the columns, at this database: a later full save from that build would not write `method` back.

The link table has zero rows, so the backfill updates nothing. The `UPDATE` stays so a database that already has links is not given `now()` for old rows.

---

## 5. `store.ts` changes

Already present in `server/store.ts` and `server/registry.ts`. The restarted dev server loaded the table with these columns. `tests/dependency-link-method.test.ts` passed on `scholario_ops_ui_test`.

In the `dependency_links` table descriptor:

- Add `method` and `updated_at` to `columns`.
- Write `l.method` and `l.updatedAt`.
- Load `r.method` (null stays null) and `iso(r.updated_at)`.

`DependencyLink` in `src/types/index.ts` gains optional `method` and required `updatedAt`.

`buildLink` in `server/registry.ts`:

- Accept `method` with the same allowed list. Omit or null means unset.
- On update, set `updatedAt` to now and keep `createdAt`.
- Keep rejecting a second row with the same `fromId`, `toId`, and `featureId`.
- Keep refusing a feature that is not `BUSINESS_FEATURE`, and keep refusing `from_id = to_id`.
- Do not read or write `prdServerId`, `drServerId`, or `application_environments`.

`registry_components` mappings stay unchanged. Name uniqueness stays `registryNameKey`: NFKC, upper, then lower. Do not switch it to PostgreSQL `lower()`.

---

## 6. Validation rules

Already enforced, and still the rules after the column add:

| Rule | Where |
|---|---|
| Consumer and provider must already be register components | `buildLink` |
| No self-link | SQL check and `buildLink` |
| `link_type` is `HARD` or `SOFT` | SQL check and `buildLink` |
| Feature, if set, is kind `BUSINESS_FEATURE`, and is neither end of the link | `buildLink` only. The FK does not check kind |
| One link per consumer, provider, and feature | `dependency_links_excl` and `buildLink` |
| Component name unique per kind via `name_key` | `registry_components_name_key_uq` and `buildComponent` |
| One register row per existing application id, and per existing server id | exclusion constraints |
| Application id and server id must exist when set | `buildComponent` |
| Kind cannot be changed in place | `buildComponent` |
| Owner required, name required, name at most 200 characters, notes at most 500 | `buildComponent` / `buildLink` |

New, after approval:

| Rule | Where |
|---|---|
| `method` is null or one of `HTTP`, `API`, `DATABASE`, `EMBED`, `LINK`, `OTHER` | SQL check and `buildLink` |
| `method` does not create a second unique key | not added to `dependency_links_excl` |
| Rationale remains `notes` | no new column |
| Failure behaviour remains `link_type` | no new column |
| Saving a link does not change hosting | no write to `applications` or `servers` |

Invalid references: unknown `from_id`, `to_id`, `feature_id`, `application_id`, or `server_id` is a 400 from `buildLink` / `buildComponent`. A duplicate link or duplicate component name is a 409 (`RegistryConflict`).

---

## 7. Test plan

Run only after approval, against a throw-away schema (`npm test` already creates one). Do not point tests at production.

Fixture: two existing-style application rows and two server rows created inside the test. Assert their ids and `prd_server_id` / `dr_server_id` after every dependency case.

| Case | Expect |
|---|---|
| Application dependency | Consumer `APPLICATION` component linked to its `applications.id`. Provider is another `APPLICATION` component. Link `from_id` → `to_id`. Neither application’s server ids change |
| Server dependency | Provider kind `SERVER` with `server_id` set to an existing server. No new `servers` row. The application’s `prd_server_id` stays the hosting value and is not replaced by this link |
| Database dependency | Provider kind `DATABASE`. `method` `DATABASE`. No write to `application_environments.db_engine` |
| Third-party API dependency | Provider kind `THIRD_PARTY_API`. `method` `API`. Name lives on the component, not a new table |
| HARD | `link_type` `HARD`. Impact walk marks the consumer stopped. `method` may be null |
| SOFT | `link_type` `SOFT`. Impact degrades the consumer. The named feature is still a hard edge under the current `failureEdges` rule. This test records that behaviour. It does not change it |
| Feature-level | `feature_id` points at `BUSINESS_FEATURE` whose `application_id` is the consumer application. A second feature between the same pair is allowed. The same feature twice is not |
| Duplicate prevention | Same `from_id`, `to_id`, and feature (including both null) returns 409 and does not insert. Same pair with a different `method` is still a duplicate |
| Invalid references | Unknown component id, feature of the wrong kind, self-link, and a feature id equal to either end return 400. Unknown `method` returns 400 and the SQL check would reject it if it bypassed the API |
| Hosting unchanged | Before and after, `prd_server_id`, `dr_server_id`, hostname, and IP are identical. Row counts of `applications` and `servers` do not grow because of a link |
| Empty register | Zero links is valid. The API does not invent a link |
| Timestamps | `created_at` stable across an edit. `updated_at` moves. `method` null round-trips |

No test in this task inserts into the developer database.

---

## 8. Risks and recommendations

1. **Auto-migrate.** Approving the SQL is not the same as dropping it into `server/migrations`. Do that only in the implementation task, together with `store.ts`.
2. **Do not add a parallel table** such as `application_dependencies`. The nine applications and their servers already exist. New work creates register components that point at those ids, then links. It does not copy the applications.
3. **Empty register is not “no dependencies”.** The UI already says so. This migration does not insert the missing relationships.
4. **Do not treat UNKNOWN as DOWN.** This change does not touch `recomputeApplication`. A link with no live check is still ignored by `registrySignals`.
5. **SOFT plus a feature still stops that feature.** That is application logic, not a missing column. Leave it until a separate decision.
6. **`method` is a closed list.** `OTHER` plus `notes` covers the “etc.”. Widening the list is a later check-constraint change.
7. **One method per relationship.** If product later needs HTTP and database as two links with no feature, uniqueness must change. Not in `017`.
8. **Name fold.** Keep `name_key` on the application side. A database `lower()` unique index was removed in `008` because it disagreed with the application.
9. **Impact.** Keep `registryImpact`. Do not add a second calculator that reads `method`.

**Recommendation:** `method` and `updated_at` were the only columns added. The other eight MVP items stay on the columns in section 2. Approval did not insert a link. On 16 Nov 2026 the dev server applied `017` to `scholario_ops_dev`, and `tests/dependency-link-method.test.ts` passed on `scholario_ops_ui_test`.

**Approval checklist**

1. No new table. Hosting stays on `applications.prd_server_id` and `dr_server_id`.
2. Consumer is `from_id`. Provider is `to_id`. Hard and Soft stay `link_type`.
3. Add only `method` and `updated_at`, using the check list in section 3.
4. Do not insert the nine applications, the fifteen servers, or any dependency. The ids in section 0 are the rows to attach to later.
5. Do not treat UNKNOWN as DOWN, and do not treat zero links as “no dependencies”.
6. Leave the SOFT-plus-feature rule unchanged.

---

## Inspection log

**Inspected:** `server/migrations/001_init.sql`, `003_environment_inventory.sql`, `007_dependency_register.sql`, `008_registry_deferred_uniqueness.sql`, `017_dependency_mvp.sql`, `server/store.ts` descriptors for links, components, and environments, `server/registry.ts` (`buildComponent`, `buildLink`, `failureEdges`, `methodOf`), `server/registryName.ts`, `DependencyLink` and `RegistryComponent` in `src/types/index.ts`. `tests/dependency-link-method.test.ts` was executed on `scholario_ops_ui_test` and passed.

**Read from `scholario_ops_dev` before and after the restart:** application ids, tiers, status, PRD/DR server ids, dependency-link columns, and migration names. Hosting rows matched. Link count stayed 0. No URL, token, password, or `servers.ip` value was selected.

**Not done:** inserting a dependency, a remote production database, Cloudflare, Hostinger. The signed-in screens were not clicked; the login page loaded and this session had no password.

**Decision:** the checklist above was approved and applied.
