import { relations } from "drizzle-orm";

import {
  agentDeploymentArtifacts,
  agentDeployments,
  agentEnvironments,
  agentEnvironmentRevisions,
  agents,
} from "./agents.js";
import { accountIdentities, accounts, platformSessions } from "./identity.js";
import {
  agentInstallationObservations,
  agentInstallations,
  clientInstallationObservations,
  clientInstallations,
  physicalDevices,
} from "./installations.js";
import {
  developerTokens,
  organizationMemberships,
  organizations,
} from "./organizations.js";

export const accountRelations = relations(accounts, ({ many }) => ({
  identities: many(accountIdentities),
  memberships: many(organizationMemberships),
}));

export const accountIdentityRelations = relations(
  accountIdentities,
  ({ one, many }) => ({
    account: one(accounts, {
      fields: [accountIdentities.accountId],
      references: [accounts.id],
    }),
    sessions: many(platformSessions),
  }),
);

export const organizationRelations = relations(organizations, ({ many }) => ({
  memberships: many(organizationMemberships),
  agents: many(agents),
  physicalDevices: many(physicalDevices),
}));

export const membershipRelations = relations(
  organizationMemberships,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [organizationMemberships.organizationId],
      references: [organizations.id],
    }),
    account: one(accounts, {
      fields: [organizationMemberships.accountId],
      references: [accounts.id],
    }),
    developerTokens: many(developerTokens),
    clientInstallations: many(clientInstallations),
  }),
);

export const agentRelations = relations(agents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agents.organizationId],
    references: [organizations.id],
  }),
  environments: many(agentEnvironments),
  deployments: many(agentDeployments),
  installations: many(agentInstallations),
}));

export const deploymentRelations = relations(
  agentDeployments,
  ({ one, many }) => ({
    agent: one(agents, {
      fields: [agentDeployments.agentId],
      references: [agents.id],
    }),
    artifacts: many(agentDeploymentArtifacts),
    environmentRevisions: many(agentEnvironmentRevisions),
    installationObservations: many(agentInstallationObservations),
  }),
);

export const physicalDeviceRelations = relations(
  physicalDevices,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [physicalDevices.organizationId],
      references: [organizations.id],
    }),
    clients: many(clientInstallations),
  }),
);

export const clientInstallationRelations = relations(
  clientInstallations,
  ({ one, many }) => ({
    device: one(physicalDevices, {
      fields: [clientInstallations.physicalDeviceId],
      references: [physicalDevices.id],
    }),
    observations: many(clientInstallationObservations),
    agents: many(agentInstallations),
  }),
);

export const agentInstallationRelations = relations(
  agentInstallations,
  ({ one, many }) => ({
    client: one(clientInstallations, {
      fields: [agentInstallations.clientInstallationId],
      references: [clientInstallations.id],
    }),
    agent: one(agents, {
      fields: [agentInstallations.agentId],
      references: [agents.id],
    }),
    observations: many(agentInstallationObservations),
  }),
);
