/// <reference types="astro/client" />

type Env = {
  DB: D1Database;
  DAILY_SEND_QUEUE: Queue;
  ENCRYPTION_KEY: string;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  RAZORPAY_PLAN_ID: string;
  RESEND_API_KEY: string;
  ANTHROPIC_API_KEY: string;
};

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
    };
  }
}
