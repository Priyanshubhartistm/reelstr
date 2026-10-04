# @reelstr/agent

Two small services. The generation agent takes paid scene jobs (adapters for Wan 2.2 via fal, Gemini Veo, and a built-in demo model). The verifier re-renders open-model scenes from their manifest and publishes a signed Source Verified label.

**Main exports:** `Agent`, `Verifier`, `verifyScene`, `FalWanAdapter`, `GeminiVeoAdapter`, `MockAdapter`.

**Test:** `bun test services/agent`.
