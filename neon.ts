import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  functions: {
    pushoutbox: {
      name: "Push notification outbox",
      source: "./neon/functions/push-outbox.ts",
      env: {
        DATABASE_URL: process.env.DATABASE_URL!,
        PUSH_WORKER_SECRET: process.env.PUSH_WORKER_SECRET!,
        VAPID_SUBJECT: process.env.VAPID_SUBJECT!,
        VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY!,
        VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY!
      }
    }
  },
  triggers: {
    pushOutboxEveryMinute: { type: "schedule", function: "pushoutbox", cron: "* * * * *" }
  }
});
