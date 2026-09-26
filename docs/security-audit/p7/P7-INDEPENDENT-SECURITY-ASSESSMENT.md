# P7 — INDEPENDENT SECURITY ASSESSMENT & ROBUSTNESS VALIDATION REPORT

**Target Platform:** Volaco Core (VibeCode Studio Core Platform Engine)  
**Assessment Phase:** P7 Independent Zero-Day Red Team & Robustness Audit  
**Assessment Mode:** AUDIT ONLY (Strictly zero application code/test modifications)  
**Evaluation Date:** 2026-09-13  
**Auditor:** Independent Security Evaluation & Red Team Unit  
**Status:** COMPLETE  

---

## 1. Executive Summary

Following the conclusion of campaigns P1 through P6, an independent, zero-day security assessment and robustness evaluation was executed across Volaco Core.

Under the absolute mandate **AUDIT ONLY / NO CODE CHANGES**, the objective was not to replay past known findings or rely on green test suites ("PASS ≠ SECURE"), but to actively hunt for unhandled failure modes, parser discrepancies, cross-component edge cases, and trust boundary failures.

### Assessment Outcome Summary:
* **Confirmed Vulnerabilities (2):**
  * **P7-VULN-01 (MEDIUM - CVSS 5.3):** Systemic Unhandled TypeErrors via Null JSON Payloads Across Secondary API Mutation Routes.
  * **P7-VULN-02 (LOW-MEDIUM - CVSS 4.3):** AI Proxy Internal TypeError Masked as 502 Upstream Gateway Error with Runtime Exception Leak.
* **Suspected Findings (2):**
  * **P7-SUSP-01 (LOW / INFO):** Pre-Authentication Static Asset Shadowing of Authenticated Studio Shell Routes.
  * **P7-SUSP-02 (INFO):** In-Memory Multi-Tenant Store Scaling & Unbounded Heap Growth.
* **Hardening Recommendations (3):** Centralized JSON validator, strict error boundary segregation in AI proxy, and generic production error sanitization.
* **False Positives Investigated (4):** Cross-tenant IDOR, RBAC header forgery, shell command injection bypass, and prompt injection role spoofing were tested and verified to be robustly mitigated.
* **Baseline Non-Regression:** 100% PASS across 1,547 tests (Gate 1: 31/31; Gate 2: 1516/1516).

---

## 2. Scope

The assessment encompassed all runtime services, domain packages, middleware, REST routes, WebSocket upgrade handlers, and frontend shells in `volaco-core`:

### Target Boundaries:
* **API Entry & Dispatch:** `apps/api/src/server.ts`
* **Route Handlers (18 modules):** `projects.ts`, `revisions.ts`, `files.ts`, `workspace.ts`, `settings.ts`, `terminal.ts`, `ai.ts`, `audit.ts`, `activity.ts`, `dashboard.ts`, `observability.ts`, `strategy.ts`, `evolution.ts`, `feature-intelligence.ts`, `feedback.ts`, `health.ts`, `studio.ts`, `project-state.ts`.
* **Security & Auth Middleware:** `apps/api/src/middleware/auth.ts`, `packages/core/src/identity/permissions.ts`.
* **Domain Subsystems:**
  * Project & Workspace Management (`projectStore`, `workspaceService`, `settingsService`)
  * Versioning & Rollback (`revisionStore`, `revisionsService`)
  * File System & Virtual Tree (`fileStore`, `fileTreeService`, `fileOperationsService`)
  * Safe Execution Sandbox (`terminalService`, command whitelist)
  * AI Gateway & Proxy (`aiUsageTracker`, `sanitizeAiMessages`, token bounds)
  * Observability & Audit Trail (`auditService`, `metricsCollector`)
* **Frontend Delivery:** `apps/studio/index.html`, `volaco_studio.html`, CSP headers, sandbox iframe attributes.

---

## 3. Methodology

Testing was conducted according to the rigorous mandate:
```text
DISCOVER → REPRODUCE SAFELY → COLLECT EVIDENCE → CLASSIFY → CONTINUE ASSESSMENT
```
1. **Zero Assumption of Safety:** Existing unit or integration tests passing did not prevent manual and programmatic probing of identical components under extreme edge conditions.
2. **Strict Evidence Standard:** No finding is designated as `CONFIRMED` without an executable, non-destructive reproduction script, observed HTTP request/response traces, and server stack traces.
3. **No Code Modifications:** Zero application lines, configuration settings, or test assertions were touched during the discovery and verification phases.

---

## 4. Architecture / Attack Surface

Volaco Core is structured as a zero-external-dependency TypeScript modular monolith:
* **Entrypoint:** Native Node.js `http.createServer` handling request dispatch, body consumption (`readBody`), static asset delivery, and global exception trapping.
* **Core Storage Layer:** In-memory repository stores (`Map<string, T>`) indexed by `tenantId` and `projectId`.
* **Trust Boundaries:**
  1. *Public Network → HTTP Server:* Protected by HTTPS enforcement (production), CSP headers, and body size caps (10 MB).
  2. *HTTP Request → Route Handler:* Protected by HMAC-SHA256 JWT validation and tenant claim extraction.
  3. *Tenant A ↔ Tenant B:* Enforced by tenant-scoped store lookups and ownership assertions (`assertProjectAccess`).
  4. *User ↔ System Execution:* Controlled by RBAC matrices (`VIEWER`, `ENGINEER`, `ADMIN`, `OWNER`) and terminal command whitelisting.
  5. *Client ↔ AI Provider:* Governed by token caps, prompt injection sanitization, tenant concurrency limits, and provider key masking.

---

## 5. Authentication

### Evaluated Controls:
* **Mechanism:** Bearer token authentication in `apps/api/src/middleware/auth.ts`.
* **Signature Integrity:** Verified via HMAC-SHA256. Probed with tampered signatures, unsupported algorithms (`alg: none`), and expired timestamps. All rejected with HTTP 401.
* **Context Extraction:** Client headers cannot forge or override the authenticated `tenantId`, `userId`, or `role` extracted from verified JWT claims.
* **Divergence Analysis:** Client-controlled URLs (`/projects/:id`) are strictly matched against the tenant context embedded in the token.

---

## 6. Authorization (RBAC)

### Evaluated Controls:
* **Role Hierarchy:** `VIEWER` (0) < `ENGINEER` (1) < `ADMIN` (2) < `OWNER` (3).
* **Enforcement Point:** `assertPermission(context.role, requiredPermission)` before executing domain mutations.
* **Runtime Verification:**
  * `VIEWER` attempting `POST /revisions` → HTTP 403 Forbidden (`FORBIDDEN`).
  * `VIEWER` attempting `POST /terminal/execute` → HTTP 403 Forbidden.
  * `VIEWER` attempting `POST /ai/chat/completions` → HTTP 403 Forbidden.
  * `ENGINEER` attempting `DELETE /projects/:id` → HTTP 403 Forbidden.
  * `ADMIN` attempting `DELETE /projects/:id` → HTTP 200 OK.

---

## 7. Multi-Tenancy

### Evaluated Controls:
* **Data Hermeticity:** All core entities (`Project`, `Revision`, `File`, `Settings`, `Audit`) are stored and queried using composite keys or tenant filter predicates.
* **IDOR / BOLA Probing:**
  * Tenant A created Project `proj_d509151aca93`.
  * Tenant B queried `GET /api/v1/projects/proj_d509151aca93` → HTTP 404 (`NotFoundError`).
  * Tenant B attempted `PUT /api/v1/projects/proj_d509151aca93/settings` → HTTP 404.
  * Tenant B attempted `POST /api/v1/projects/proj_d509151aca93/revisions` → HTTP 404.
* **Conclusion:** Complete isolation maintained. Existence of foreign tenant resources is not leaked.

---

## 8. Business Logic

### Versioning & Rollback Lifecycle:
* Rollbacks follow an append-only forward progression model (validated in P6-REMEDIATION-005).
* Rolling back to an older revision does not destroy intermediate history; it generates a new incremental revision with parent linkage and recorded rollback origin metadata.
* Tested state transitions: `DRAFT → CONFIGURING → GENERATING → READY → ERROR` behave deterministically according to specifications.

---

## 9. AI Security

### Evaluated Controls:
* **Prompt Injection Defense:** `sanitizeAiMessages` strips or downgrades `system` roles supplied by untrusted clients into `user` messages.
* **Token Capping:** `max_tokens` is bounded to `[1, 4096]` (default 2048) to prevent cost exhaustion attacks.
* **Concurrency Capping:** Tenant AI concurrency limit enforced (`MAX_CONCURRENT_AI_PER_TENANT = 5`).
* **Vulnerability Discovered (P7-VULN-02):** Unchecked property access on `parsedBody` when given a `null` JSON payload throws a `TypeError` that leaks into the upstream 502 gateway error handler.

---

## 10. Agents & Tools

### Evaluated Controls:
* Agent execution capabilities are gated by `ToolRegistry.allowedTools`.
* Agents cannot escalate permissions beyond their initiating user context.
* Terminal tools strictly enforce a binary whitelist (`git`, `npm`, `node`, `ls`, `dir`, `cat`, `echo`, etc.) and reject metacharacters (`&&`, `;`, `|`, `>`, backticks, `$`).

---

## 11. Filesystem Security

### Evaluated Controls:
* Virtual and physical file operations are handled by `FileStore`.
* Relative paths are validated against path traversal (`../`, `..\`, null bytes `%00`).
* Cross-project file boundary tests confirmed that project files cannot escape their assigned logical project workspace.

---

## 12. Network & Outbound Requests

### Evaluated Controls:
* Outbound network communication is restricted to AI provider endpoints (`api.mistral.ai`, `codestral.mistral.ai`).
* SSRF validation rejects loopback (`127.0.0.1`, `localhost`) and cloud metadata endpoints (`169.254.169.254`).
* No unvalidated user-controlled URLs are fetched by the backend.

---

## 13. Rate Limiting & Resource Exhaustion

### Evaluated Controls:
* **Body Size Caps:** Requests exceeding `MAX_BODY_BYTES` (10 MB) are terminated with HTTP 413.
* **AI Rate Limiting:** Status polling DoS protection (P6-VULN-04) caches availability checks, avoiding provider quota starvation.
* **Systemic Exception Exhaustion (P7-VULN-01):** Sending `null` JSON payloads triggers HTTP 500 error logging overhead across 14 mutation endpoints.

---

## 14. Concurrency & Race Conditions

### Evaluated Controls:
* Executed 5 concurrent revision creation requests on the same project from the same tenant simultaneously.
* In-memory sequential execution ensured atomic revision number incrementation (`rev_1`, `rev_2`, `rev_3`...) with 100% HTTP 201 responses and zero state corruption.

---

## 15. Database & Storage Invariants

### Evaluated Controls:
* Architecture currently utilizes in-memory transactional maps.
* Invariant verification confirmed that project mutations and revision snapshots maintain 1:1 state parity without orphaned file nodes.

---

## 16. Error Handling & Information Disclosure

### Evaluated Controls:
* Standard errors (`AppError`, `NotFoundError`, `ForbiddenError`, `ValidationError`) return sanitized JSON schemas `{ error: { code, message, statusCode, requestId } }`.
* **Information Leak Identified (P7-VULN-02):** The AI proxy error handler concatenates `fetchErr.message` directly into the client-facing HTTP 502 message, exposing V8 runtime internals (`Cannot read properties of null (reading 'max_tokens')`).

---

## 17. HTTP / Proxy & Transport

### Evaluated Controls:
* **HSTS:** Enforces `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` in production and HTTPS environments.
* **Reverse Proxy Trust:** `X-Forwarded-*` headers are only respected if coming from trusted proxy CIDRs.
* **CORS & Framing:** `X-Frame-Options: SAMEORIGIN` and strict CSP prevent framing by untrusted origins.

---

## 18. Browser & Studio Security

### Evaluated Controls:
* The Studio Shell (`apps/studio/index.html`) runs under a locked Content-Security-Policy.
* Preview iframes utilize sandbox isolation preventing cross-origin DOM access back into the studio workspace.

---

## 19. Secrets & Configuration Management

### Evaluated Controls:
* Secrets (`MISTRAL_API_KEY`, `JWT_SECRET`) are consumed via environment variables.
* The logging subsystem (`logger.ts`) sanitizes sensitive keys (`API_KEY`, `SECRET`, `PASSWORD`, `TOKEN`) and masks authorization headers before disk/console output.

---

## 20. Supply Chain & Dependencies

### Evaluated Controls:
* **Zero Production Dependencies:** `package.json` specifies empty production `dependencies`.
* Build and dev tooling consists exclusively of `@types/node`, `typescript`, and `vitest`.
* Minimal attack surface; zero exposure to malicious npm lifecycle hooks or upstream dependency hijackings.

---

## 21. Observability & Audit Trail

### Evaluated Controls:
* All security-sensitive operations (project creation, settings updates, revision rollbacks, terminal executions, AI queries) generate structured JSON audit records.
* Audit records are tenant-isolated and include `requestId`, `timestamp`, `tenantId`, and `role`.

---

## 22. Composite Scenarios

### Tested Chains:
1. *Multi-Tenant Concurrency Attack:* Multiple tenants executing simultaneous mutations and rollbacks. Handled cleanly without cross-tenant bleed.
2. *Viewer to Mutator Bypass:* An authenticated `VIEWER` attempting to inject mutations via composite routes (`/files/operation`, `/feedback/analyze`). Consistently blocked at authorization checkpoint.
3. *Null Payload DOS Chain:* Triggering unhandled exceptions across multiple endpoints sequentially. Handled by server top-level catch without crashing Node process, but generates repeated HTTP 500/502 errors.

---

## 23. Open-Ended Review (Assumption Testing)

### Assumption Probed: "Does JSON.parse always return a valid object?"
* **Finding:** In JavaScript/V8, `JSON.parse("null") === null`, `JSON.parse("123") === 123`, `JSON.parse("[]")` is an Array.
* **Flaw:** Code assumes `const payload = JSON.parse(...)` is a dictionary object. This unvalidated assumption is the root cause of both P7-VULN-01 and P7-VULN-02.

---

## 24. Confirmed Findings

### P7-VULN-01 — Systemic Unhandled TypeErrors via Null JSON Payloads Across Secondary Mutation Routes
* **Category:** Input Validation & Error Handling
* **Severity:** MEDIUM
* **CVSS v3.1 Score:** 5.3 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
* **Component:** API Route Handlers (14 routes across 8 modules)
* **Preconditions:** Valid authentication token (or accessible endpoint).
* **Reproduction:** Send HTTP PUT/POST with body `null` and `Content-Type: application/json`.
* **Observed Result:** Unhandled `TypeError: Cannot read properties of null`, producing HTTP 500 Internal Server Error.
* **Expected Result:** HTTP 400 Bad Request (`ValidationError: Le corps de la requête doit être un objet JSON valide`).
* **Root Cause:** In P6-REMEDIATION-006, only `POST /api/v1/projects` was patched with `typeof payload !== 'object' || Array.isArray(payload)`. All other mutation routes remained unpatched.

---

### P7-VULN-02 — AI Proxy Internal TypeError Masked as 502 Upstream Gateway Error with Runtime Leak
* **Category:** Error Handling & Information Disclosure
* **Severity:** LOW-MEDIUM
* **CVSS v3.1 Score:** 4.3 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`)
* **Component:** AI Proxy Route (`POST /api/v1/ai/chat/completions`)
* **Preconditions:** Valid authentication with `PROJECT_MUTATE` permission.
* **Reproduction:** Send `POST /api/v1/ai/chat/completions` with body `null`.
* **Observed Result:** Throws `TypeError: Cannot read properties of null (reading 'max_tokens')`, caught by generic upstream handler, returning HTTP 502 with message `"Erreur de communication avec le fournisseur IA : Cannot read properties of null (reading 'max_tokens')"`.
* **Expected Result:** HTTP 400 Bad Request with generic error message.
* **Root Cause:** Direct property access on `parsedBody` without null validation, caught inside the fetch error block which assumes all unhandled errors are Mistral upstream network errors.

---

## 25. Suspected Findings

### P7-SUSP-01 — Pre-Authentication Static Asset Shadowing of Authenticated Studio Shell Routes
* **Severity:** LOW / INFORMATIONAL
* **Description:** Static file serving in `server.ts` intercepts `/`, `/index.html`, `/shell`, and `/studio` before authentication runs, shadowing dynamic tenant rendering in `handleStudioRoutes`.

### P7-SUSP-02 — In-Memory Store Scaling & Unbounded Heap Growth
* **Severity:** INFORMATIONAL
* **Description:** In-memory repository stores lack LRU eviction policies or heap limits, creating vulnerability to memory exhaustion under sustained enterprise load.

---

## 26. Hardening Recommendations

1. **Centralized Request Parsing Middleware:** Implement an abstracted parser in `auth.ts` or `packages/core`:
   ```typescript
   export function parseJsonBody<T = Record<string, unknown>>(bodyText: string, requestId?: string): T {
     let parsed: unknown;
     try {
       parsed = JSON.parse(bodyText || '{}');
     } catch {
       throw new ValidationError('Format JSON invalide', undefined, requestId);
     }
     if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
       throw new ValidationError('Le corps de la requête doit être un objet JSON valide', undefined, requestId);
     }
     return parsed as T;
   }
   ```
2. **AI Proxy Try/Catch Separation:** Isolate payload parsing and token bound validation from the upstream provider network dispatch (`fetch`) block.
3. **Generic Production Error Sanitization:** Ensure `fetchErr.message` is never reflected in HTTP response payloads.

---

## 27. False Positives (Investigated & Disproved)

1. **FP-01: Cross-Tenant Project Enumeration via ID Guessing:** Tested by attempting cross-tenant project lookups. Verified that all return HTTP 404 identical to non-existent projects. Disproved.
2. **FP-02: RBAC Role Spoofing via Client Headers:** Tested supplying `x-user-role: ADMIN` as a `VIEWER`. Server strictly honors the cryptographically signed JWT claim. Disproved.
3. **FP-03: Terminal Command Chaining Bypass:** Tested metacharacter injection (`git status && whoami`, `cat file | sh`). Regex whitelist successfully rejects the entire payload. Disproved.
4. **FP-04: System Prompt Injection via Client Message Role:** Tested injecting `{ role: 'system', content: 'override' }`. `sanitizeAiMessages` strips or downgrades the role to `user`. Disproved.

---

## 28. Tests Executed

1. `scripts/poc_p7_findings.mjs`: Live server reproduction of `null` payloads across 15 routes + AI proxy.
2. `scripts/test_p7_deep_checks.mjs`: Multi-tenant isolation, RBAC matrix validation, security headers, and concurrent revisions burst.
3. `scripts/run_gate1_tests.mjs`: Foundation & unit integration suite (31 tests).
4. `scripts/run_gate2_tests.mjs`: Complete system regression suite (1516 tests).
5. `red-team-p6-hunt.test.js`: P6 regression attack suite (12 tests).

---

## 29. Evidence

### Live HTTP Execution Traces:
```http
PUT /api/v1/projects/proj_e6cf7554a25d/settings HTTP/1.1
Content-Type: application/json
Authorization: Bearer <valid_token>

null

HTTP/1.1 500 Internal Server Error
{"error":{"code":"INTERNAL_ERROR","message":"Erreur interne du serveur","statusCode":500,"requestId":"req_239ef46c26bd47e3"}}
```

```http
POST /api/v1/ai/chat/completions HTTP/1.1
Content-Type: application/json
Authorization: Bearer <valid_token>

null

HTTP/1.1 502 Bad Gateway
{"error":{"code":"INTERNAL_ERROR","message":"Erreur de communication avec le fournisseur IA : Cannot read properties of null (reading 'max_tokens')","statusCode":502,"requestId":"req_d5b411e77dec42c8"}}
```

---

## 30. Regression Results

* **TypeScript Typecheck (`tsc --noEmit`):** 0 errors.
* **Quality Gate 1:** 31 / 31 PASS (100%).
* **Quality Gate 2:** 1,516 / 1,516 PASS (100%).
* **Repository Mutation Status:** Zero application code, configurations, or tests modified.

---

## 31. Final Risk Assessment

| Finding ID | Severity | Likelihood | Impact | CVSS v3.1 | Status |
|---|---|---|---|---|---|
| **P7-VULN-01** | MEDIUM | HIGH | LOW-MEDIUM | 5.3 | CONFIRMED |
| **P7-VULN-02** | LOW-MEDIUM | MEDIUM | LOW | 4.3 | CONFIRMED |
| **P7-SUSP-01** | LOW / INFO | LOW | LOW | 2.1 | SUSPECTED |
| **P7-SUSP-02** | INFO | LOW | MEDIUM | 1.9 | SUSPECTED |

---

# FINAL VERDICT

### SECURITY FINDINGS
* **CRITICAL:** 0
* **HIGH:** 0
* **MEDIUM:** 1 (P7-VULN-01)
* **LOW:** 1 (P7-VULN-02)
* **INFO:** 2 (P7-SUSP-01, P7-SUSP-02)

### CONFIDENCE
* **VERY HIGH** (Demonstrated via live HTTP requests, server logs, and reproduction scripts)

### SECURITY STATUS
```text
CONDITIONAL
```
*(Confirmed medium-severity unhandled exception defect affecting 14 API routes and runtime diagnostic information disclosure defect in the AI proxy endpoint. Multi-tenant boundaries and RBAC enforcement remain fully intact.)*
