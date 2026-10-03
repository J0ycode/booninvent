"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { suggestRestockAction } from "./actions";

export function SuggestButton() {
  const router = useRouter();
  const { run, pending } = useAction(suggestRestockAction, {
    onSuccess: (r) => {
      if (!r) toast.info("Nothing is at or below its reorder level right now.");
      else router.push(`/store/restock/${r.id}`);
    },
  });
  return (
    <Button variant="outline" onClick={() => run()} disabled={pending}>
      <Sparkles /> {pending ? "Checking…" : "Suggest restock"}
    </Button>
  );
}
