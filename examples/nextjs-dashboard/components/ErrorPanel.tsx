"use client";

import { useEffect, useRef } from "react";
import type { HeatError } from "@m-software-engineering/heat-errors";
import type { Copy } from "../lib/copy";
import CopyButton from "./CopyButton";

type Props = {
  error: Pick<HeatError, "code" | "message" | "fix"> & { requestId?: string };
  copy: Copy;
  onRetry: () => void;
};

/** What "Copy details" puts on the clipboard: the error code and request id, never raw JSON. */
export const errorDetails = (error: { code: string; requestId?: string }) =>
  `code: ${error.code}\nrequestId: ${error.requestId ?? "-"}`;

/** Generic error (#29): `{message}`, `{fix}`, then Retry (focused) and Copy details. */
export default function ErrorPanel({ error, copy, onRetry }: Props) {
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => retry.current?.focus(), [error]);
  return (
    <div role="alert" className="ph-alert" data-code={error.code}>
      <p>{error.message}</p>
      <p>{error.fix}</p>
      <div className="actions">
        <button type="button" ref={retry} onClick={onRetry}>
          {copy.retry}
        </button>
        <CopyButton text={() => errorDetails(error)} label={copy.copyDetails} done={copy.copied} />
      </div>
    </div>
  );
}
