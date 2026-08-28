# Organization users v1

**Status:** Accepted
**Date:** 2026-08-27

## Decision

Keep the first organization model deliberately small:

- One company is one organization.
- Users belong to the company through organization memberships.
- Membership roles are owner, admin, developer, and viewer.
- The organization owns many projects, and each project is one agent.
- Active organization users can see the organization's agents.
- Production deployment selects the current release for an agent.

No additional schema is needed. The approved core PostgreSQL migration already
contains every required subject.

## Not in v1

- organization groups or subgroup membership;
- direct-user or group agent assignments;
- organization-device enrollment;
- installation observations or desired-versus-observed views;
- organization-domain tables;
- organization policy tables; and
- billing or Cloud-operations tables.

The desktop remains locally authoritative for its installed packages and
runtime state. The Platform manages organization users, agent releases, and
environment deployments; it does not track every employee device yet.

Add any deferred subject only after a real workflow requires it and its logical
model receives a separate explicit approval.

The [agent deployments and installations proposal](agent-deployments-and-installations-proposal.md)
now proposes client and agent installation tracking without reintroducing
groups or assignment subjects. It remains unimplemented pending approval.
