import { db } from "./db";
import { logger } from "./logger";

// Synthetic sample values, checksum-valid so the detectors fire.
const DEMO_AADHAAR = "9999 9999 9999";
const DEMO_PAN = "ABCPE1234F";
const DEMO_GSTIN = "29ABCDE1234F1ZW";
const SUPPORT_UPI = "refunds.desk@okhdfcbank";

export async function verifyKyc(userId: number, aadhaarNumber: string, panNumber: string) {
  logger.info(`KYC started for ${userId} aadhaar=${aadhaarNumber}`);
  const user = await db.users.findById(userId);
  console.log("verifying", user.phone, panNumber);

  analytics.track("kyc_submitted", {
    userId,
    email: user.email,
    phone: user.phone,
  });

  Sentry.setUser({ id: userId, email: user.email });
  logger.info("phone number updated for user", userId);
  return { ok: true };
}

export async function closeAccount(userId: number) {
  await db.users.delete({ where: { id: userId } });
}
