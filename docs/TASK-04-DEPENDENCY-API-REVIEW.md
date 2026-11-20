# Task 04 — Dependency API review

**Status:** Reviewed on 17 Nov 2026 against the register that Task 03 approved. No new route. No new table. No dependency row was inserted into `scholario_ops_dev`.

The module API is still `POST`, `GET`, `PATCH`, and `DELETE` on `/api/v1/dependency-links`, plus the register routes. An application id is not a link end. The consumer and the provider remain register component ids. `from_id` depends on `to_id`.

---

## 1. Integration with application records

`GET /api/v1/applications/:id` now returns the stored application plus `serviceDependencies`. That object is built for the response. It is not written onto the application row, and it is not returned by `GET /api/v1/applications` or by bootstrap.

| Field | Meaning |
|---|---|
| `componentId` | The `APPLICATION` register row whose `application_id` is this application. Null when the application has no register row. |
| `outgoing` | Links whose `from_id` is that row. This application depends on the other end. |
| `incoming` | Links whose `to_id` is that row. The other end depends on this application. |
| `otherApplicationId` | The application record at the other end, when that end is still bound. Otherwise null. |
| `status` | Live status of the other end. An unbound database, API, or provider is `UNKNOWN`. `UNKNOWN` is not DOWN. |

`Application.dependencies` is unchanged. It is the derived monitor list, plus a register link only when that link has a real check. A register row with no check does not appear there and does not change application status.

The application Dependencies tab reads the same projection as `serviceDependencies` (`src/lib/serviceDependencies.ts`). A stale application or a stale server is `WARNING` on that row. `UNKNOWN` means there is no check. The client method is `getApplication`. The list endpoint still returns the stored rows only.

Incident Impact Analysis now stores `applications[].id` as the application record id when the register entry is bound to one. The register component id stays in `componentId`. Older snapshots that were saved before this change still hold a register id in `applications[].id`. The incident screen prints the name, so those rows still read correctly. A lookup of an old snapshot id against `applications` will miss.

Deleting an application or a server clears the register pointer and then recomputes derived status before the save. A consumer that was `CRITICAL` or `WARNING` only because the deleted record had a live check returns to its own monitors on that request. The link row remains. Empty `otherApplicationId` means the other end is no longer an application record.

---

## 2. Validation

Checked on create and on update.

| Case | Status |
|---|---|
| Missing consumer or provider, unknown id, self-link, `method` outside `HTTP`, `API`, `DATABASE`, `EMBED`, `LINK`, `OTHER` | 400 |
| `fromId` or `toId` is an application id or a server id | 400. The message names the register entry to use. Hosting is not accepted as a dependency id. |
| `featureId` is an application id or a server id | 400. The message asks for a business feature. |
| Feature is not `BUSINESS_FEATURE`, feature is either end of the link, notes longer than 500 characters | 400 |
| Feature application id is set and is not the consumer’s application id, or only one of the two is bound | 400. `The feature must belong to the consumer application` |
| Consumer is an application or one of its features, and the provider is that application’s production or recovery server | 400. Hosting stays on `prd_server_id` and `dr_server_id`. A database or other component may still depend on that server. |
| Both the consumer and the feature are unbound register rows | Allowed. The propagation tests use this shape. |
| Unknown `applicationId` on an `APPLICATION` or `BUSINESS_FEATURE` component | 400. `Application not found` |
| `applicationId` on a database, storage system, API, provider, or server component | 400 |
| Second `APPLICATION` component for one application id | 409 |
| Second link for the same consumer, provider, and feature, including a different `method` or a different Hard/Soft value | 409 |
| Register id or link id that does not exist | 404 |

`method` is trimmed. `api` is rejected. The register screen sends the uppercase value from its list. Empty method is stored as null.

---

## 3. Create, read, update, delete

Exercised on `scholario_ops_ui_test` only, schema dropped afterwards.

| Operation | Result |
|---|---|
| `POST /api/v1/dependency-links` | 201 and `{ success, data }` |
| `GET /api/v1/dependency-links` and `GET /api/v1/dependency-links/:id` | 200. Unknown id is 404. |
| `PATCH` of type, notes, and method | 200. Omitted method is kept. Blank method clears it. `createdAt` stays. `updatedAt` moves. |
| `DELETE /api/v1/dependency-links/:id` | 200 `{ deleted: true }`. The next read is 404. |
| `GET /api/v1/applications/:id` | Includes `serviceDependencies` for that application and does not put those link ids into `dependencies`. |
| Delete of the provider application | Consumer status falls back to its own monitor. The link remains with `otherApplicationId` null. |

`tests/dependency-register.test.ts` passed, 13 of 13. `tests/incident-impact.test.ts` passed, 6 of 6. The operations-ready suite passed, including the provider-delete check, 11 of 11 in that file.

---

## 4. Authorization

`requireAuth` covers every route under `/api/v1`. Writes use `requireRole('it_administrator')`. A higher role is included. The numbers match `src/lib/roles.ts`.

| Role | Read registry, links, and the application | Create, update, delete a link or a register entry |
|---|---|---|
| Anonymous | 401 | 401 |
| `viewer` | 200 | 403 |
| `operator` | 200 | 403 `Requires it_administrator role or higher` |
| `it_administrator` | 200 | 201 / 200 |
| `super_admin` | 200 | 201 / 200. The first user created from `ADMIN_EMAIL` is this role. |

The Dependency Register hides save controls with `canDo('create_application')`, which is `it_administrator` and `super_admin`. A viewer or an operator does not see them. The API still returns 403 if they call it. That is the same gate as creating an application. No separate dependency permission was added.

---

## 5. Issues fixed in this review

1. A feature with no application, or a feature of a different application, could be named on a consumer that is bound to an application. The link is now rejected.
2. An application id or a server id sent as `featureId` came back as `Feature not found`. The message now says which kind of id it is.
3. `GET /api/v1/applications/:id` did not show the register links for that application. It now returns `serviceDependencies` on a copy of the row.
4. Deleting an application or a server cleared the register pointer and saved status without recomputing. A consumer could stay `WARNING` or `CRITICAL` until the five-second engine tick. Recompute now runs before that save.
5. Impact Analysis stored the register component id in `applications[].id`. New snapshots store the application record id when the entry is bound.
6. An application or its feature could depend on that application’s own production or recovery server, and server CPU could mark the application down. Those links are now rejected. The register screen no longer offers those two servers as providers. A link that is already stored is ignored by status. A database may still depend on the server, and impact still walks that path.
7. Renaming an application, or changing its tier, left the bound `APPLICATION` register row on the old name and tier. The application save now copies name and tier onto that row. Owner and description stay as the register editor set them. A description-only save does not rewrite the register name. A name already used by another application entry returns 409 and leaves both rows unchanged.
8. A stale application was reported as `UNKNOWN` on a dependency row, which is the same word as “no check”. It is now `WARNING`, matching a stale server.
9. The dependency editor listed every business feature. It now lists only features the API will accept for that consumer, so a feature of another application is not offered. The API still returns 400 if one is submitted.
10. Derived application and server status was recalculated in memory and not always saved. `recomputeDerived` now saves when an application, a server, or a maintenance window actually changes.

---

## 6. Issues left as they are

1. Deleting an application does not delete its register row or its links. `application_id` becomes null. The component can still be a link end. That is the rule from Task 02.
2. `method` is not part of the unique key. A second method between the same consumer, provider, and feature is 409, not a second row.
3. A Soft link that names a feature still stops that feature. The rest of the consumer is degraded. This review does not change that rule.

---

## 7. Review conclusion

The dependency API is fit to use against the nine existing applications. Reads are any signed-in role. Writes are `it_administrator` and `super_admin`. Invalid fields return 400. A duplicate consumer, provider, and feature returns 409. A missing link returns 404. Application detail stays a read of the same links. The editor stays on Setup.

---

## 8. Completed remarks — authentication, validation, and migration safety

Completed on 18 Nov 2026. This is the security and validation pass. It uses the platform roles already in `server/auth.ts`. It does not add a second permission or a per-user application owner.

| Check | Result |
|---|---|
| Authentication | Every `/api/v1` route after the worker event is behind `requireAuth`. No token and a bad token are 401 `{ success: false, code: 'UNAUTHORIZED', message }`. |
| Authorization | Dependency and register writes use `requireRole('it_administrator')`. `super_admin` is included because its level is higher. A viewer and an operator can read and receive 403 `FORBIDDEN` on create, update, and delete. The stored link is unchanged after a 403. |
| Incoming dependency requests | `POST` and `PATCH` go through `buildLink`. The body must be one JSON object. Ends, type, feature, method, criticality, and the text fields are checked. A password or token in those texts is 400. An `applicationId` field on a link is 400. |
| Error shape | Validation is 400 `VALIDATION`. A duplicate is 409 `CONFLICT`. A missing link or application is 404 `NOT_FOUND`. The body is `{ success: false, code, message }` and has no `data`. |
| Application records | A signed-in user may read an application by its own id. A register id, a server id, a dependency id, or a code name used in place of that id is 404 and returns no application. Anonymous read is 401. A viewer cannot patch or delete the application. |
| Migrations | `007`, `008`, `017`, and `018` are forward only. Each file runs in one transaction. A failure rolls that file and its `schema_migrations` row back. `017` and `018` add columns with `IF NOT EXISTS`, fill existing rows before `NOT NULL`, and do not insert links. The runner does not un-apply a file that succeeded. Manual rollback is the `DROP COLUMN` text at the top of `017_dependency_mvp.sql` and `018_dependency_layer1.sql`, and it discards only those new values. |

The checks are the ones already exercised in `tests/dependency-api.test.ts` and `tests/dependency-register.test.ts`. Both files passed on 18 Nov 2026.
