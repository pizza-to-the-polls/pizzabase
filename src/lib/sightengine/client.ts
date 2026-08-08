export async function checkGenai(
  imageUrl: string
): Promise<{ score: number } | null> {
  const apiUser = process.env.SIGHTENGINE_API_USER;
  const apiSecret = process.env.SIGHTENGINE_API_SECRET;

  if (!apiUser || !apiSecret) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const params = new URLSearchParams({
      models: "genai",
      url: imageUrl,
      api_user: apiUser,
      api_secret: apiSecret,
    });

    const response = await fetch("https://api.sightengine.com/1.0/check.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });

    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining && parseInt(remaining, 10) < 5) {
      console.warn(`SightEngine rate limit low: ${remaining} remaining`);
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      type?: { ai_generated?: number };
    };
    const score = data?.type?.ai_generated;

    if (typeof score !== "number") {
      return null;
    }

    return { score };
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
