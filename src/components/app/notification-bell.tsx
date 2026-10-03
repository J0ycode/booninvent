import { notifications } from "@/server/data/dashboard";
import type { Ctx } from "@/server/context";
import { BellMenu } from "./bell-menu";

/** Server part: notices are computed on page load (no realtime). */
export async function NotificationBell({ ctx }: { ctx: Ctx }) {
  const items = await notifications(ctx).catch(() => []);
  return <BellMenu items={items} />;
}
