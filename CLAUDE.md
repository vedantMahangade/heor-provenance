# HEOR Provenance Agent

## What this is
A tool that drafts pharma HEOR value-dossier sections from real evidence, then makes
every claim independently verifiable. The product is the VERIFICATION/PROVENANCE layer,
not the text generation. The LLM is a commodity drafter; do not center the product on it.

## The loop (this is the whole MVP — do not add features beyond it)
1. Input: drug + indication.
2. Fetch real evidence from PubMed E-utilities (esearch + efetch). Keep PMIDs + abstract text.
3. Draft dossier claims with the LLM, CLAIM-LEVEL GROUNDED: each claim must map to a
   specific source span (PMID + supporting sentence). Any claim the model can't ground
   gets flagged or dropped — never written as fact.
4. Bundle { claims[], sources[], model, version, timestamp, sha256 } as one JSON evidence blob.
5. Store the blob on Walrus (testnet HTTP API) -> get blobId.
6. Write blobId + agent metadata into ENS text records on Sepolia.
7. Verify view: resolve ENS name -> read blobId -> fetch blob from Walrus -> recompute sha256
   -> render dossier with a "provenance verified" banner showing the chain of custody.

## Stack
- Next.js + TypeScript, single repo. Deploy to Vercel for the live demo URL.
- LLM: use the `openai` npm package pointed at a FREE OpenAI-compatible endpoint via env vars.
  Default base URL = Groq (https://api.groq.com/openai/v1) or Gemini
  (https://generativelanguage.googleapis.com/v1beta/openai/). Code must be provider-agnostic:
  LLM_BASE_URL, LLM_API_KEY, LLM_MODEL in .env. Never hardcode a provider.
- Evidence: PubMed E-utilities over HTTP (free). Optional NCBI_API_KEY for rate limit.
- Storage: Walrus testnet. PUT $PUBLISHER/v1/blobs, GET $AGGREGATOR/v1/blobs/{id}.
  Handle both newlyCreated and alreadyCertified response shapes. Retry GET with backoff
  (CDN may 404 right after upload).
- Identity: ENS on Sepolia. Reads via viem getEnsText. Writes server-side via a wallet
  client + the resolver's setText, using a THROWAWAY testnet private key. Use ensjs if simpler.
- ENS text record keys (prefixed): heor.dossier.latest, heor.agent.version, heor.agent.capabilities.

## Hard rules
- No hard-coded values anywhere in the demo path — reads must be live from chain + Walrus.
- .env in .gitignore. The repo is PUBLIC. Never commit any key. Provide .env.example.
- Testnet only. The private key is disposable and holds only Sepolia test ETH.
- Keep the pitch honest: augmentation + provenance tool with a human in the loop,
  NOT autonomous drafting.

## Build order
Phase 1: backend pipeline only (PubMed -> grounded draft -> JSON bundle). No UI, no chain.
Phase 2: add Walrus PUT + ENS setText. Run the full loop from a script.
Phase 3: minimal Next.js UI — a Generate form and a Verify view. Deploy to Vercel.
Phase 4: README + architecture diagram + <=5 min demo video.

## Submission
ENS Integrate (split pool) + Walrus "best new build". Public repo, live demo, video required.
ENS requires in-person booth presentation Sunday morning.