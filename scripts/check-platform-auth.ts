import { checkPlatformAuth } from "./platform-auth-readiness.js";

const url =
  process.argv[2] ??
  process.env.RADIUS_PLATFORM_URL ??
  "http://localhost:3100/";
try {
  await checkPlatformAuth(url);
  console.log(
    `Native auth discovery is ready at ${url}. A real sign-in still verifies client registration and membership.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Platform auth readiness failed",
  );
  process.exitCode = 1;
}
