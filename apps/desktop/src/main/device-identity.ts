import type { CredentialVault } from "./credential-vault";

export function localDeviceIdentity(vault: CredentialVault): {
  clientInstanceId: string;
  displayName: string;
  platform: NodeJS.Platform;
  publicKeyJwk: CredentialVault["publicKeyJwk"];
} {
  return {
    clientInstanceId: vault.clientInstanceId,
    displayName: process.platform === "darwin" ? "This Mac" : "This device",
    platform: process.platform,
    publicKeyJwk: vault.publicKeyJwk,
  };
}
