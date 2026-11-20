# Task 05 — Dependency API tests

**Status:** Completed on 18 Nov 2026. The suite ran against `scholario_ops_ui_test` only. Each file used its own schema and dropped it afterwards. `scholario_ops_dev` was not used. No dependency row was inserted there.

The suite is `tests/dependency-api.test.ts`. It calls `POST`, `GET`, `PATCH`, and `DELETE` on `/api/v1/dependency-links`, then reads the same links from `GET /api/v1/applications/:id` and from impact. Consumer and provider remain register component ids. `from_id` depends on `to_id`.

---

## 1. Results

| Suite | Result |
|---|---|
| `tests/dependency-api.test.ts` | 8 passed, 0 failed |
| `tests/dependency-register.test.ts` | 13 passed, 0 failed |
| `tests/dependency-link-method.test.ts` | 7 passed, 0 failed |
| `tests/service-dependencies.test.ts` | 6 passed, 0 failed |
| `tests/registry-store.test.ts` | 14 passed, 0 failed |

Command: `npm run test:local -- tests/dependency-api.test.ts` and the four regression files above.

---

## 2. What the new suite checks

| Scenario | Result |
|---|---|
| Create a Hard link and a Soft link | 201 `{ success, data }`. Stored `fromId` and `toId` are lowercase. `method` and `criticality` are trimmed. `createdAt` equals `updatedAt` on create. |
| List and get one | 200. The list contains the new ids. Get accepts the id in either case. An unknown id is 404 `Dependency link not found`. |
| Application read | `GET /api/v1/applications/:id` includes the link under `serviceDependencies`, with Hard or Soft and the feature name. `applicationLevel` lists the links that can change that application. A Soft link that names a feature is not in that list. The monitor list `dependencies` does not contain the link id. `GET /api/v1/applications` does not add `serviceDependencies`. |
| Update | 200. Type, method, notes, criticality, failure behaviour, and recovery expectation change. Omitted fields stay. Blank method clears it. `createdAt` stays. `updatedAt` moves. The id in the URL may be uppercase. |
| Delete | 200 `{ deleted: true }`. The next read is 404. The list loses that id only. The register component and the application row remain. The PostgreSQL row is gone. |
| Hard and Soft | Impact of a Hard provider lists the consumer as `HARD` (stops). Impact of a Soft provider lists the consumer as `SOFT` (degraded). Patching Soft to Hard, then back to Soft, changes that classification. `link_type` in PostgreSQL matches. |
| Soft link that names a feature | The feature is `HARD` (it stops). The consumer application is not in the impact list. |
| Invalid application reference | An application id, including the same id in uppercase, is 400 and names the register entry. A server id is 400 and names the server’s register entry. The consumer’s own production server is 400. Hosting stays on the application. |
| Application deleted | The link remains and can still be read. The register `applicationId` becomes null. A later link to that component stores `otherApplicationId` null. |
| Duplicate relationship | The same consumer, provider, and feature is 409, including a different type, method, or criticality, and including uppercase ids. The opposite direction is a different relationship and is 201. The same ends with a different feature are 201. A rejected duplicate does not add a row. A patch that would collide leaves the stored ends unchanged. |
| Blank end on update | `fromId` or `toId` sent as null or whitespace is 400. The stored type, ends, and notes stay. Omitting the field still keeps the stored end. |
| Other validation | Self-link, unknown id, non-uuid, `hard` / `soft` in the wrong case, notes that contain a password, failure text over 500 characters, a body that is an array, and a body that is not JSON are 400. `applicationId` on a link is 400. |
| Authorization | No token and a bad token are 401 `UNAUTHORIZED`. A viewer and an operator can read and receive 403 `Requires it_administrator role or higher` on create, update, and delete. The link is unchanged after those 403s. `it_administrator` can create, update, and delete. The first user, from `ADMIN_EMAIL`, is `super_admin` and can do the same. |

Error bodies are `{ success: false, code, message }` with no `data`. Codes used here are `VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, and `CONFLICT`.

---

## 3. Defects fixed

1. A uuid in the other case was not the same id. An application id sent in uppercase came back as “not in the register” instead of “that id is an application”. A register id in uppercase could not be used as a link end. A link id in uppercase could not be read, updated, or deleted. Ids are now compared in lowercase, which is how PostgreSQL stores a uuid.
2. A blank consumer or provider on update did not mean one thing. `null` or `""` kept the old end and still saved the other fields in that request. Whitespace became `""` after trimming and was rejected by a different check. A present blank end is now rejected, and the stored link is left as it was. Leaving the field out still keeps the stored end.

---

## 4. Left as they are

1. Deleting an application does not delete its register row or its links. `application_id` becomes null. The component can still be a link end.
2. `method` is not part of the unique key. A second method between the same consumer, provider, and feature is 409.
3. A Soft link that names a feature stops that feature. The consumer application is not added to the impact list. The register screen already says this: Soft with a feature means only that feature stops. Soft with no feature means the project keeps running, but worse.

---

## 5. Completed remarks

Completed. Creation, retrieval, update, deletion, invalid application references, duplicate relationships, Hard and Soft classification, authorization, and error handling are covered by `tests/dependency-api.test.ts` and the regression files in section 1. The two backend defects in section 3 are fixed. The three rules in section 4 stay as they are. The later same-day re-run of `dependency-api`, `dependency-register`, and `service-dependencies` was 27 passed, 0 failed. `dependency-link-method` and `registry-store` were not part of that later re-run; their 18 Nov results in section 1 still stand.
