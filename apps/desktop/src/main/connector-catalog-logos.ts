import type {
  ConnectorCatalogEntry,
  ConnectorCatalogListResponse,
} from "@curve-ai/radius-connector-protocol";

export async function resolveConnectorCatalogResponseLogos(
  response: ConnectorCatalogListResponse,
  resolveEntries: (
    entries: ConnectorCatalogEntry[],
  ) => Promise<ConnectorCatalogEntry[]>,
): Promise<ConnectorCatalogListResponse> {
  const [connectors, categoryPreviews] = await Promise.all([
    resolveEntries(response.connectors),
    Promise.all(
      response.categoryPreviews.map(async (preview) => ({
        ...preview,
        connectors: await resolveEntries(preview.connectors),
      })),
    ),
  ]);
  return { ...response, connectors, categoryPreviews };
}
