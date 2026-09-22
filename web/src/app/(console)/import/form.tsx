"use client";

import { useState } from "react";
import { extractRotation, type ExtractionResult } from "./actions";

export function ImportForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);

  async function onSubmit(form: FormData) {
    setBusy(true);
    setResult(null);
    try {
      setResult(await extractRotation(form));
    } finally {
      setBusy(false);
    }
  }

  const errors = result?.findings?.filter((f) => f.level === "error") ?? [];
  const warnings = result?.findings?.filter((f) => f.level === "warn") ?? [];
  const info = result?.findings?.filter((f) => f.level === "info") ?? [];

  return (
    <>
      <form action={onSubmit}>
        <div className="row">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="file">Rotation PDF, image, or CSV</label>
            <input id="file" type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt" />
          </div>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Reading…" : "Extract"}
          </button>
        </div>
      </form>

      {result?.error && (
        <p className={result.retryable ? "tag warn" : "err"}>
          {result.error}
          {result.retryable && " Nothing is wrong with the file — press Extract again."}
        </p>
      )}

      {result?.ok && (
        <>
          <div className="head" style={{ marginTop: 24, marginBottom: 12 }}>
            <h2 style={{ marginBottom: 4 }}>Checks</h2>
            <p>
              Nothing here is saved. The staging table and the accept/reject step land with
              the roster schema.
            </p>
          </div>

          {info.map((f, i) => (
            <p key={`i${i}`} className="tag ok">{f.message}</p>
          ))}
          {errors.map((f, i) => (
            <p key={`e${i}`} className="tag off">
              {f.row ? `Row ${f.row}: ` : ""}{f.message}
            </p>
          ))}
          {warnings.map((f, i) => (
            <p key={`w${i}`} className="tag warn">
              {f.row ? `Row ${f.row}: ` : ""}{f.message}
            </p>
          ))}

          <table style={{ marginTop: 20 }}>
            <thead>
              <tr>
                <th>#</th><th>Week</th><th>Date</th><th>Day</th>
                <th>Start</th><th>End</th><th>Module</th><th>Groups</th>
              </tr>
            </thead>
            <tbody>
              {result.sessions?.map((s, i) => (
                <tr key={i}>
                  <td className="dim">{i + 1}</td>
                  <Cell value={s.week} />
                  <Cell value={s.date} mono />
                  <Cell value={s.day} />
                  <Cell value={s.start} mono />
                  <Cell value={s.end} mono />
                  <Cell value={s.module} mono />
                  <Cell value={s.groups?.join(" ")} />
                </tr>
              ))}
            </tbody>
          </table>

          {result.meta && (
            <p className="dim" style={{ fontSize: 12, marginTop: 16 }}>
              {result.meta.model} · {(result.meta.ms / 1000).toFixed(1)}s
              {result.meta.inputTokens !== undefined &&
                ` · ${result.meta.inputTokens} in / ${result.meta.outputTokens} out`}
            </p>
          )}
        </>
      )}
    </>
  );
}

/// A null is the model saying it could not read the cell, which is a different thing from an
/// empty one and has to look different — it is the row you have to go and check by eye.
function Cell({ value, mono }: { value: string | number | null | undefined; mono?: boolean }) {
  if (value === null || value === undefined || value === "") {
    return <td className="tag warn">unreadable</td>;
  }
  return <td className={mono ? "mono" : undefined}>{value}</td>;
}
