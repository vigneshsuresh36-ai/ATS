import { DEPARTMENTS } from "./roles";
import type { AppUser } from "./types";

/** The owner is supplied by each installation, never bundled into the product. */
export function initialAdministrator(emailInput: string | undefined, nameInput: string | undefined, createdAt: string): AppUser {
  const email = (emailInput || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL to the initial customer administrator's email before starting a new installation.");
  return { id: email, email, name: (nameInput || "Administrator").trim() || "Administrator", role: "Admin", title: "Admin", departments: [...DEPARTMENTS], active: true, createdAt };
}
