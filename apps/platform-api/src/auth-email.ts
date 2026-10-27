import nodemailer from "nodemailer";

export type AuthEmail = { email: string; otp: string; type: string };
export type AuthEmailSender = (message: AuthEmail) => Promise<void>;

export function createAuthEmailSender(
  environment: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): AuthEmailSender {
  const provider = environment.RADIUS_AUTH_EMAIL_PROVIDER ?? "resend";
  const from = environment.AUTH_EMAIL_FROM;
  if (!from?.trim() || /[\r\n]/.test(from))
    throw new Error("Set AUTH_EMAIL_FROM to the configured sender address");
  if (provider === "resend") {
    const key = environment.RESEND_API_KEY;
    if (!key?.trim())
      throw new Error(
        "Set RESEND_API_KEY or explicitly configure SMTP for auth email",
      );
    return async ({ email, otp }) => {
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Your Radius sign-in code",
          text: `Your Radius sign-in code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) {
        console.error(
          `[auth-email] Resend rejected delivery (HTTP ${response.status})`,
        );
        throw new Error("Auth email delivery failed");
      }
      const receipt = (await response.json()) as { id?: unknown };
      if (typeof receipt.id !== "string")
        throw new Error("Auth email delivery failed");
      console.info(`[auth-email] Resend accepted message ${receipt.id}`);
    };
  }
  if (provider !== "smtp")
    throw new Error("RADIUS_AUTH_EMAIL_PROVIDER must be resend or smtp");
  const smtp = new URL(environment.RADIUS_AUTH_SMTP_URL ?? "");
  if (!["smtp:", "smtps:"].includes(smtp.protocol))
    throw new Error("Configure an SMTP or SMTPS URL");
  const local = ["localhost", "127.0.0.1", "mailpit"].includes(smtp.hostname);
  const allowPlaintext =
    environment.RADIUS_LOCAL_DEVELOPMENT === "true" && local;
  const transport = nodemailer.createTransport(
    {
      host: smtp.hostname,
      port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
      secure: smtp.protocol === "smtps:",
      requireTLS: !allowPlaintext,
      auth: smtp.username
        ? {
            user: decodeURIComponent(smtp.username),
            pass: decodeURIComponent(smtp.password),
          }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    },
    { from },
  );
  return async ({ email, otp }) => {
    await transport.sendMail({
      to: email,
      subject: "Your Radius sign-in code",
      text: `Your Radius sign-in code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
    });
  };
}
