import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className={buttonVariants()}>
        Go to my dashboard
      </Link>
    </main>
  );
}
