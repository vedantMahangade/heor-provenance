/**
 * Walrus testnet storage client.
 *
 * Stores the JSON evidence bundle as a blob and reads it back by blobId. The
 * blobId is content-addressed by Walrus, so combined with our own sha256 it
 * gives two independent integrity anchors. Endpoints come from env so the
 * publisher/aggregator can be swapped without code changes.
 *
 *   PUT  ${WALRUS_PUBLISHER}/v1/blobs?epochs=5   -> store, returns blobId
 *   GET  ${WALRUS_AGGREGATOR}/v1/blobs/{blobId}  -> read back
 */

const TESTNET_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const TESTNET_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

/** Store demo blobs for 5 epochs so they don't expire mid-demo. */
const STORE_EPOCHS = 5;

function getPublisher(): string {
  return (process.env.WALRUS_PUBLISHER ?? TESTNET_PUBLISHER).replace(/\/+$/, "");
}

function getAggregator(): string {
  return (process.env.WALRUS_AGGREGATOR ?? TESTNET_AGGREGATOR).replace(/\/+$/, "");
}

/** Shape of the publisher's store response (only the parts we read). */
interface StoreResponse {
  newlyCreated?: { blobObject?: { blobId?: string } };
  alreadyCertified?: { blobId?: string };
}

/**
 * Store a JSON string on Walrus and return its blobId.
 *
 * The publisher returns one of two shapes depending on whether this exact blob
 * already existed on the network — we handle both.
 */
export async function storeBlob(json: string): Promise<string> {
  const url = `${getPublisher()}/v1/blobs?epochs=${STORE_EPOCHS}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: json,
  });

  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`Walrus store failed: ${res.status} ${res.statusText} ${detail}`);
  }

  const data = (await res.json()) as StoreResponse;
  const blobId =
    data.newlyCreated?.blobObject?.blobId ?? data.alreadyCertified?.blobId;

  if (!blobId) {
    throw new Error(
      `Walrus store returned no blobId. Response: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return blobId;
}

export interface ReadOptions {
  /** Number of attempts before giving up. */
  maxAttempts?: number;
  /** Base delay (ms) for exponential backoff. */
  baseDelayMs?: number;
}

/**
 * Read a blob back as text by blobId.
 *
 * The aggregator CDN can return 404 for a short window right after upload, so
 * we retry up to maxAttempts with exponential backoff specifically on 404.
 * Other errors fail fast.
 */
export async function readBlob(
  blobId: string,
  { maxAttempts = 5, baseDelayMs = 1000 }: ReadOptions = {},
): Promise<string> {
  const url = `${getAggregator()}/v1/blobs/${blobId}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url);

    if (res.ok) {
      return res.text();
    }

    if (res.status === 404 && attempt < maxAttempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
      continue;
    }

    const detail = await safeText(res);
    throw new Error(
      `Walrus read failed for ${blobId}: ${res.status} ${res.statusText} ${detail}`,
    );
  }

  // Exhausted retries on repeated 404.
  throw new Error(
    `Walrus read failed for ${blobId}: blob not found after ${maxAttempts} attempts.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
