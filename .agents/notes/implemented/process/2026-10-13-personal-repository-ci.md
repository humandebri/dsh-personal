# Agent Note: CI for the personal DSH repository

Status: implemented

English | [中文](2026-10-13-personal-repository-ci.zh.md)

## Problem

The personal repository inherits organization-specific runner labels, Issue Project automation, release-family checks and credentialed workflows. Those services are not configured in `humandebri/dsh-personal`, so inherited PR checks either wait for unavailable runners or fail before validating code.

## Decision

The personal repository uses GitHub-hosted Ubuntu and Windows runners for every required CI job. Job commands, dependencies and failure propagation remain intact. Existing runner selection for other repositories remains unchanged.

Issue policy checks out trusted default-branch code and rewrites only its REST repository namespace from the known personal repository identity before preflight. Policy eligibility, current-state revalidation and Project credential requirements remain intact. The organization Project lifecycle and upstream npm release rehearsals do not run in the personal repository; this repository does not publish the upstream release families. Local packages still follow the root version, workspace dependency ranges and publication-file constraints enforced by ordinary static CI.

Real-provider E2E requires `DSH_PERSONAL_REAL_API_E2E=true`; enabling it still requires the existing API secret and excludes fork and Dependabot PRs. Cloudflare preview requires `DSH_PERSONAL_CLOUDFLARE_PREVIEW=true` and the existing deployment credentials. Disabled jobs are skipped, not evidence of successful API calls or deployments. Keyless unit, browser, compatibility, coverage and artifact checks continue to run.

Clean-checkout validation also repairs integration omissions in the existing personal additions: split Host/Client project references, classify their catalog types and service roles, regenerate documentation from committed sources, use typed fixtures, and share queue rendering and attachment reads. Shared queue mutations reject repeated submissions while a save is pending; multiline editing and tooltip portals retain the main composer behavior.

## Consequences

Personal PRs can validate code without upstream infrastructure. Reviewed resolving-Issue PRs still require valid Project configuration; this change does not provision a personal Project or its App credentials. GitHub-hosted runners have less capacity than the upstream runners, so complete CI can take longer.

## Alternatives considered

**Use inherited organization services.** The personal repository cannot access their runners and credentials.

**Disable the code checks.** It would conceal regressions rather than repair the execution environment.

## Verification

Workflow tests evaluate personal runner selection, secret-dependent opt-ins and fork restrictions while retaining the upstream cases. Issue-policy tests execute the workflow script against personal, upstream and unrelated repository identities, proving that only the personal namespace changes and trusted policy code remains unchanged. Live Actions results validate installation, execution and required-job completion before merging.
