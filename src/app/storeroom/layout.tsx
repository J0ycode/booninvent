import { PortalLayout } from "@/components/app/portal-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PortalLayout role="STOREROOM_MANAGER">{children}</PortalLayout>;
}
