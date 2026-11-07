"use server";

import { notifications, type Notice } from "@/lib/notifications";

/** The signed-in person's notifications (scoped to the clients they can see). */
export async function loadNotifications(): Promise<Notice[]> {
  try {
    return await notifications();
  } catch {
    return [];
  }
}
