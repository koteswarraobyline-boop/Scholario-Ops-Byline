# Task 03 — Application Dependency Management module

**Status:** Approved on 16 Nov 2026. Step 2 is done: the dev server restarted and applied `017`. `tests/dependency-link-method.test.ts` passed, 5 of 5, on `scholario_ops_ui_test` only. The sign-in page at `http://127.0.0.1:3000/login` loads. The signed-in register screens were not clicked in this session because no password was available here. No dependency row was inserted.

**Depends on:** `docs/TASK-01-EXISTING-CODEBASE-ANALYSIS.md` and `docs/TASK-02-DEPENDENCY-MODEL-ASSESSMENT.md`.

The module is an extension of the register that is already in the product. It is not a second application catalogue and not a second dependency table.

---

## 1. Consumer and provider

A dependency is one sentence: the consumer depends on the provider.

| Term | Stored as | Meaning |
|---|---|---|
| Consumer | `dependency_links.from_id` | The register component that needs the other one. For an application, that component is the existing `APPLICATION` row whose `application_id` is the application id in Task 01 section 5. |
| Provider | `dependency_links.to_id` | The register component that is needed. An application provider is that application’s existing `APPLICATION` component. A database, storage system, third-party API, or external provider is a component of kind `DATABASE`, `STORAGE`, `THIRD_PARTY_API`, or `PROVIDER`. |
| Direction | `from_id` depends on `to_id` | Failure walks the other way: from the provider toward the consumers (`failureEdges` in `server/registry.ts`). |
| Feature | `feature_id`, optional | A `BUSINESS_FEATURE` that needs this provider. The feature’s own `application_id` is the application that offers the feature. |

The nine applications already have consumer-side components. A link between two of them uses those two ids. It does not create an application, a server, or a second component for the same application id. The database rejects a second `APPLICATION` component for one `application_id`.

Hosting is not this relationship. `applications.prd_server_id` and `dr_server_id` mean “this application runs on these servers”. LXP Portal, Scholario Lumo, and Scholario Websites have no DR server. That absence is valid hosting. It is not a missing dependency row.

`application_environments.db_engine` is the hint the agent uses to probe a database on that server. It is not a service dependency.

---

## 2. Hard and Soft

`link_type` is the classification. There is no second column for failure behaviour.

| Class | Stored value | When the provider is unhealthy |
|---|---|---|
| Hard | `HARD` | The consumer stops. Impact lists it as stopped. `recomputeApplication` may raise the consumer application to the provider’s checked status (`WARNING`, `CRITICAL`, `STALE`, or `MAINTENANCE`). |
| Soft | `SOFT` | The consumer keeps running, degraded. Impact lists it as degraded. `recomputeApplication` may raise the consumer application only as far as `WARNING`. |

Rules that stay as they are:

- A provider with no live check is ignored by `registrySignals`. It does not mark the consumer UNKNOWN and it does not mark the consumer DOWN.
- UNKNOWN is not DOWN. The seven applications with no monitors stay UNKNOWN until a monitor exists. A Hard or Soft link does not invent that monitor.
- A healthy provider never makes an unmonitored consumer look healthy.
- A feature named on a link is a hard edge from the provider to that feature, even when the link is Soft. The feature stops. The rest of the consumer follows Hard or Soft. This plan does not change that rule.
- A component cannot depend on itself. One link is allowed per consumer, provider, and feature. `method` is not part of that key.

---

## 3. What is stored, and what is not

| Fact | Where |
|---|---|
| Consumer, provider | `from_id`, `to_id` |
| Hard or Soft | `link_type` |
| Feature | `feature_id` or null |
| How the consumer reaches the provider | `method`: `HTTP`, `API`, `DATABASE`, `EMBED`, `LINK`, `OTHER`, or null when not recorded |
| Why the dependency exists | `notes`, called the rationale in the UI. Empty means not recorded |
| When the link was created and last saved | `created_at`, `updated_at` after `017` |
| Which VPS the application runs on | `applications.prd_server_id`, `dr_server_id` only |

`017` is the only schema change, and it is the change already described in Task 02. No `application_dependencies` table. No backfill. `src/mocks/dependencyDemoData.ts` is a labelled illustration. It is not imported.

---

## 4. Backend API

No new route. The register routes in `server/routes.ts` are the module API. They are mounted at `/api`. Authenticated reads require a signed-in user. Writes require `it_administrator`. Success body is `{ success, data }`. Unknown component or link is 404. Validation is 400. A duplicate component name or a duplicate link is 409.

| Method and path | Role | Body / query | Result |
|---|---|---|---|
| `GET /api/v1/registry` | signed in | none | `{ components, links }` |
| `POST /api/v1/registry` | `it_administrator` | component fields | 201, the component |
| `PATCH /api/v1/registry/:id` | `it_administrator` | component fields | the component. Kind cannot change |
| `DELETE /api/v1/registry/:id` | `it_administrator` | none | `{ deleted, linksRemoved }` |
| `POST /api/v1/dependency-links` | `it_administrator` | `fromId`, `toId`, `type`, optional `featureId`, `method`, `notes` | 201, the link |
| `PATCH /api/v1/dependency-links/:id` | `it_administrator` | any of those fields | the link. Omitted `method` keeps the stored value. Null or empty clears it |
| `DELETE /api/v1/dependency-links/:id` | `it_administrator` | none | `{ deleted: true }` |
| `GET /api/v1/registry/:id/impact` | signed in | none | `RegistryImpact` from `registryImpact` |
| `GET /api/v1/registry/:id/paths` | signed in | none | `RegistryPaths` from `registryPaths` |
| `GET /api/v1/impact/preview` | signed in | `applicationId` or `serverId` or `registryId`, optional `environment=PRD\|DR` | `ImpactPreview` |

`GET /api/v1/bootstrap` already includes `registry` and `dependencyLinks`. The UI reads that payload. A write calls `persist()`, audits the action, recomputes derived status, and broadcasts `registry_changed`.

Client methods already exist on `src/services/api.ts`: `getRegistry`, `createRegistryComponent`, `updateRegistryComponent`, `deleteRegistryComponent`, `createDependencyLink`, `updateDependencyLink`, `deleteDependencyLink`, `getRegistryImpact`, `getRegistryPaths`, `getImpactPreview`.

`Application.dependencies` on the application API is the derived monitor list. It is not this module. Do not write links into it.

Errors an operator can cause, and the status the API already returns:

| Case | Status |
|---|---|
| Missing consumer or provider, unknown id, self-link, feature that is not a business feature, feature id equal to either end, `method` outside the list | 400 |
| Second link for the same consumer, provider, and feature, including a different `method` | 409 |
| Second `APPLICATION` component for an application that already has one | 409 |
| Register id or link id that does not exist | 404 |

---

## 5. Dependency Register screen

Place: Setup (`/setup`), component `src/components/setup/DependencyRegister.tsx`. This is the only editor.

**Purpose.** Record what an existing project depends on. The project list is the nine applications already stored. The operator selects one. The screen does not offer “create application” and it does not offer a hostname or URL field.

**Header.** Title “Dependency Register”. One sentence: direction is consumer → provider. Hard means the project stops if the provider fails. Soft means the project still runs, but worse. Empty links mean “not written down”, not “no dependencies”.

**Project block, one per application.** Shows the application name, tier, and its current links as `consumer → provider`, the Hard or Soft badge, the method or “not recorded”, and the rationale or “not recorded”. Actions, visible only to `it_administrator`:

- Record a dependency. Fields: provider kind (`APPLICATION`, `SERVER`, `DATABASE`, `STORAGE`, `THIRD_PARTY_API`, `PROVIDER`), provider name, owner, Hard or Soft, method (blank allowed), rationale. Saving creates the provider component when it does not already exist, reuses the application’s existing `APPLICATION` component as the consumer, and creates one link. It does not write `prd_server_id` or `dr_server_id`.
- Make hard / make soft on an existing link. That is `PATCH` of `type` only.
- Edit and delete, through the existing link dialog.

**Register entry dialog.** Edits a component: name, owner, tier, description, and for an audience kind the user count and who is served. Kind stays fixed. An application entry stays bound to the existing application id.

**Link dialog.** Consumer, provider, Hard or Soft, optional feature, method, rationale. Consumer and provider are chosen from components already in the register. The feature list is `BUSINESS_FEATURE` only.

**All-links list.** Every link, including those whose consumer is not an application. Same badges. Same role gate.

**Empty state.** “Nothing registered yet” only when there are no components. With the nine application components present and zero links, the project block shows each project and the line that nothing is recorded for it. That line must keep saying this is not proof of no dependencies.

**Demo mode.** On `/dependencies`, demo mode replaces this editor with a notice so the illustrative rows shown on that page cannot be saved from there. Setup still shows the editor. Neither screen writes `src/mocks/dependencyDemoData.ts` into `dependency_links`. Save controls use `canDo('create_application')`, which is `it_administrator` and `super_admin`. A viewer or an operator does not see them. The API still returns 403.

---

## 6. Application detail screen

Place: the existing modal in `src/components/applications/ApplicationsView.tsx`. There is no `/applications/:id` route. Do not add one for this module.

**Dependencies tab, read only.** Title “Service dependencies (read only)”. One sentence: consumer → provider from the register. This list is not an editor. “Runs on” stays on the Infrastructure tab.

**Rows.** Find the `APPLICATION` component with this application’s id.

- Outgoing: links whose `from_id` is that component. Label is `{application} → {provider}`.
- Incoming: links whose `to_id` is that component. Label is `{consumer} → {application}`.
- Each row shows Hard or Soft, method or “method not recorded”, feature name or “feature not limited to one”, rationale or “rationale not recorded”, and the other end’s live status.

**Live status on the row.** An application provider or consumer uses that application’s stored status. A server component uses that server’s stored status. Any other kind shows UNKNOWN, because it has no monitor of its own. UNKNOWN here means “no check”, not DOWN.

**Empty.** If the application has no component, or the component has no incoming and no outgoing links: “Nothing recorded. This does not mean the application has no dependencies.” LXP Portal, Scholario Lumo, and Scholario Websites must still render. Their missing DR server is shown on the Infrastructure tab, not as a dependency gap.

**Demo mode.** A banner says the picture is illustrative and not verified. Turning demo off returns this tab to the live register. Demo rows are never written by this tab.

**What this tab does not do.** It does not edit servers, URLs, monitors, failover, or links. Edit of identity and hosting stays in `AppEditor` on Setup. Edit of links stays on the Dependency Register.

---

## 7. Map and impact

These screens already read the same links. They are part of the module and they are not a second model.

| Screen | Route | Behaviour |
|---|---|---|
| Dependencies | `/dependencies` | `DependencyMapView`. Consumer → provider, Hard or Soft, method or “method not recorded”. Impact uses `registryImpact` when demo mode is off. |
| Impact | `/impact` | `ImpactView`. Stopped versus degraded, method, rationale, feature, user count or “user count not recorded”. |
| Setup impact preview | inside the register | Direct blast radius for the selected component, Hard as stops, Soft as degraded. |

Demo mode on the map shows `dependencyDemoData` behind a banner and hides the register editor on that page. It does not call the save API. Setup keeps the editor. The production operating mode is demo off.

---

## 8. Implementation plan

The editor, the detail tab, the map, the impact page, the routes, and the `store.ts` mapping are already in the tree. Approval is not a request to rebuild them. The remaining work is the database column pair and a check that the screens still tell the truth against an empty link table.

**Step 1 — Approve Task 02.** Columns are `method` and `updated_at` only. No new table. No inserted link.

**Step 2 — Apply `017` by starting the server that contains both the migration and the current `store.ts`.** Do not start an older build. Do not apply the SQL by hand and then keep the currently running process, which does not know the columns. Confirm `schema_migrations` contains `017_dependency_mvp.sql` and that `dependency_links` still has zero rows. Confirm the nine application ids and the fifteen server ids are unchanged.

**Step 3 — Run `tests/dependency-link-method.test.ts` through `npm run test:local`.** That test refuses every database except `scholario_ops_ui_test`. It must not be pointed at `scholario_ops_dev`.

**Step 4 — Browser check, demo off, against the empty register.**

- Setup shows the nine projects and zero links, with the “not written down” wording.
- Application detail for ICT shows the same empty wording, and the Infrastructure tab still shows both servers.
- Application detail for LXP Portal shows the empty wording, and the Infrastructure tab shows no DR server.
- `/dependencies` and `/impact` show no invented edges.
- An `it_administrator` can save one Hard link and one Soft link against components created for the test, then delete both, and the application and server rows are unchanged.
- A viewer or an operator does not see the save controls. The API returns 403 below `it_administrator`.

**Step 5 — Operators enter real links later, one confirmed relationship at a time.** This plan does not name those relationships. The demo file is not a list to import.

Out of scope until a separate decision: changing the Soft-plus-feature rule, adding a route, adding a table, folding VPS CPU into the dependency impact, and treating a missing DR server as a failed dependency.

---

## 9. Risks

1. Restarting before approval applies `017`. The change is additive and inserts nothing, but it is still a schema change and it waits for the Task 02 checklist.
2. Saving a Hard link to a checked provider can change Overview status through `recomputeApplication`. Test links in step 4 must be deleted before anyone relies on Overview.
3. Copying `dependencyDemoData.ts` into `dependency_links` would publish unverified relationships as operations data.
4. Creating a Hard link from an application to its own PRD server would let CPU pressure mark the application down. Hosting stays on the server ids.
5. A Soft link with a feature still stops that feature. The UI must not describe that feature as “degraded only”.

---

## Approval checklist

1. Consumer is `from_id`. Provider is `to_id`. Hard and Soft are `link_type`.
2. The API in section 4 is the module API. No new endpoint.
3. The Dependency Register in section 5 is the only editor. Application detail in section 6 is read only.
4. Hosting stays on the server ids verified in Task 02. The three applications with no DR server stay that way.
5. Zero links stays a valid state. Demo data is not imported.
6. Implementation steps 2–4 run only after this checklist and the Task 02 checklist are accepted.
