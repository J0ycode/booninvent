import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";
import { brand } from "@/config/brand";

/** Sends an email via SMTP; without SMTP_HOST (development) it prints to the console. */
export async function sendEmail(to: string, subject: string, text: string) {
  const smtp = env.smtp;
  const fullSubject = `${subject} - ${brand.name}`;
  if (!smtp.host) {
    console.info(`\n[email] To: ${to}\n[email] Subject: ${fullSubject}\n${text}\n`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transport.sendMail({ from: smtp.from, to, subject: fullSubject, text });
}
