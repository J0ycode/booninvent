"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormGrid, NativeSelect, ActionBar, CheckboxInput } from "@/components/app/form-field";
import { useAction } from "@/hooks/use-action";
import { paiseToInput } from "@/lib/format";
import type { ProductView } from "@/server/data/products";
import type { SupplierView } from "@/server/data/suppliers";
import { createProductAction, updateProductAction } from "./actions";

export function ProductForm({ product, suppliers }: { product?: ProductView; suppliers: SupplierView[] }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const opts = {
    success: product ? "Product saved" : "Product added",
    onSuccess: (p: ProductView) => router.push(`/storeroom/products/${p.id}`),
    onError: (r: { fieldErrors?: Record<string, string> }) => setErrors(r.fieldErrors ?? {}),
  };
  const create = useAction(createProductAction, opts);
  const update = useAction(updateProductAction, opts);
  const pending = create.pending || update.pending;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    const fd = new FormData(e.currentTarget);
    const input = {
      name: fd.get("name"),
      category: fd.get("category"),
      sku: fd.get("sku"),
      barcode: fd.get("barcode"),
      sellingPrice: fd.get("sellingPrice"),
      costPrice: fd.get("costPrice"),
      supplierId: fd.get("supplierId"),
      reorderLevel: fd.get("reorderLevel"),
      active: product ? fd.get("active") === "on" : true,
    };
    if (product) update.run(product.id, input);
    else create.run(input);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormGrid>
        <Field label="Product name" htmlFor="name" error={errors.name} className="md:col-span-2">
          <Input id="name" name="name" defaultValue={product?.name} required aria-invalid={!!errors.name} />
        </Field>
        <Field label="Category" htmlFor="category" error={errors.category}>
          <NativeSelect id="category" name="category" defaultValue={product?.category ?? "CLOTHING"}>
            <option value="CLOTHING">Clothing</option>
            <option value="ACCESSORY">Accessory</option>
          </NativeSelect>
        </Field>
        <Field label="Supplier" htmlFor="supplierId" hint={suppliers.length ? undefined : "Add suppliers on the Suppliers page"}>
          <NativeSelect id="supplierId" name="supplierId" defaultValue={product?.supplierId ?? ""}>
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Selling price (₹)" htmlFor="sellingPrice" error={errors.sellingPrice}>
          <Input id="sellingPrice" name="sellingPrice" inputMode="decimal" defaultValue={paiseToInput(product?.sellingPrice)} required className="num" aria-invalid={!!errors.sellingPrice} />
        </Field>
        <Field label="Cost price (₹)" htmlFor="costPrice" error={errors.costPrice} hint="Only owners and Store Room managers can see this">
          <Input id="costPrice" name="costPrice" inputMode="decimal" defaultValue={paiseToInput(product?.costPrice)} className="num" />
        </Field>
        <Field label="SKU" htmlFor="sku" error={errors.sku} hint={product ? undefined : "Leave empty to create one"}>
          <Input id="sku" name="sku" defaultValue={product?.sku} autoCapitalize="characters" />
        </Field>
        <Field label="Barcode" htmlFor="barcode" error={errors.barcode} hint={product ? undefined : "Leave empty to create a Code 128 barcode, or scan an existing one"}>
          <Input id="barcode" name="barcode" defaultValue={product?.barcode} autoComplete="off" />
        </Field>
        <Field label="Reorder level (pieces)" htmlFor="reorderLevel" error={errors.reorderLevel} hint="Stores at or below this count show as low stock">
          <Input id="reorderLevel" name="reorderLevel" inputMode="numeric" pattern="[0-9]*" defaultValue={String(product?.reorderLevel ?? 0)} className="num" />
        </Field>
        {product && (
          <label className="flex min-h-11 items-center gap-3 self-end text-sm">
            <CheckboxInput name="active" defaultChecked={product.active} />
            Active (shown to stores and in searches)
          </label>
        )}
      </FormGrid>
      <ActionBar>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : product ? "Save product" : "Add product"}
        </Button>
      </ActionBar>
    </form>
  );
}
