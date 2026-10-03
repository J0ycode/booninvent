import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  get mongoUri() {
    return required("MONGODB_URI");
  },
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
    return s;
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get smtp() {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM ?? "BoonBaby Store Manager <no-reply@localhost>",
    };
  },
  isProd: process.env.NODE_ENV === "production",
};
