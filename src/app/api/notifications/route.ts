import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const notifications = await listNotifications(user.email);
    return json({
      notifications: notifications.slice(0, 40),
      unreadCount: notifications.filter((notification) => !notification.readAt).length,
    });
  } catch (error) {
    return errResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    if (body.all === true) {
      await markAllNotificationsRead(user.email);
      return json({ ok: true });
    }
    if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 200) {
      throw new ApiError(400, "A valid notification ID is required.");
    }
    if (!(await markNotificationRead(body.id, user.email))) {
      throw new ApiError(404, "Notification not found.");
    }
    return json({ ok: true });
  } catch (error) {
    return errResponse(error);
  }
}