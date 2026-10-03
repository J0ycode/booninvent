"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Upload, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/app/section";
import { ActionBar } from "@/components/app/form-field";
import { useAction } from "@/hooks/use-action";
import { importProductsAction } from "../actions";

type Preview = {
  results: { row: number; name: string; sku: string; barcode: string; errors: string[] }[];
  valid: number;
  errorCount: number;
  imported: number;
};

const TEMPLATE = "name,category,sku,barcode,sellingPrice,costPrice,supplier,reorderLevel\nCotton Romper 0-3M,Clothing,,,499,250,,5\nBaby Bib,Accessory,,,149,60,,10\n";

export function ImportClient() {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const check = useAction(importProductsAction, { onSuccess: (d) => setPreview(d as Preview) });
  const commit = useAction(importProductsAction, {
    success: (d) => `${(d as Preview).imported} products imported`,
    onSuccess: (d) => {
      if ((d as Preview).imported) router.push("/storeroom/products");
      else setPreview(d as Preview);
    },
  });

  function onFile(file: File | undefined) {
    setPreview(null);
    setParseError(null);
    setRows(null);
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        if (!res.data.length) return setParseError("The file has no rows.");
        setRows(res.data);
        void check.run(res.data, false);
      },
      error: () => setParseError("Could not read this file. Save it as CSV (comma separated) and try again."),
    });
  }

  const bad = preview?.results.filter((r) => r.errors.length) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Section title="1. Choose a CSV file">
        <p className="mb-3 text-sm text-muted-foreground">
          Columns: <span className="font-mono text-xs">name, category, sku, barcode, sellingPrice, costPrice, supplier, reorderLevel</span>. Category is Clothing or
          Accessory. Leave sku or barcode empty to create them. Prices are in rupees. The supplier must match an existing supplier name.
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground focus-within:ring-3 focus-within:ring-ring/50">
            <Upload className="size-4" aria-hidden />
            {fileName || "Choose file"}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="products-template.csv"
            className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium hover:bg-muted"
          >
            <Download className="size-4" aria-hidden /> Template
          </a>
        </div>
        {parseError && <p className="mt-3 text-sm text-destructive">{parseError}</p>}
      </Section>

      {check.pending && <p className="text-sm text-muted-foreground">Checking {rows?.length} rows…</p>}

      {preview && (
        <Section title="2. Check the preview">
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-mint-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> <span className="num">{preview.valid}</span> ready
            </span>
            <span className={`inline-flex items-center gap-1.5 ${bad.length ? "text-destructive" : "text-muted-foreground"}`}>
              <AlertTriangle className="size-4" aria-hidden /> <span className="num">{bad.length}</span> with problems
            </span>
          </div>
          {bad.length > 0 ? (
            <>
              <p className="mb-2 text-sm">Fix these rows in your file and choose it again. Nothing is imported until every row is valid.</p>
              <ul className="max-h-96 divide-y overflow-y-auto rounded-xl border text-sm">
                {bad.slice(0, 200).map((r) => (
                  <li key={r.row} className="p-3">
                    <p className="font-medium">
                      Row <span className="num">{r.row}</span>: {r.name || "(no name)"}
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-destructive">
                      {r.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {bad.length > 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 200 problem rows.</p>}
            </>
          ) : (
            <p className="text-sm">All rows look good.</p>
          )}
          <ActionBar>
            <Button disabled={!!bad.length || !rows || commit.pending} onClick={() => rows && commit.run(rows, true)}>
              {commit.pending ? "Importing…" : `Import ${preview.valid} products`}
            </Button>
          </ActionBar>
        </Section>
      )}
    </div>
  );
}
