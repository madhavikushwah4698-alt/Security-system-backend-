// ─────────────────────────────────────────────────────────────────────────────
// Gemini API Integration Service
// Handles translation, language detection, and AI summarization for
// CrisisConnect emergency communication platform.
// ─────────────────────────────────────────────────────────────────────────────

type GeminiIncidentInsight = {
  translatedText: string;
  detectedLanguage: string;
  summary: string;
};

// ── Configuration ───────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';

// Try v1beta first (supports more models), fallback to v1
const GEMINI_API_VERSIONS = ['v1beta', 'v1'] as const;

function buildApiUrl(version: string, model: string): string {
  return `${GEMINI_API_BASE}/${version}/models/${model}:generateContent`;
}

// ── Types ───────────────────────────────────────────────────────────────────

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type GeminiErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

// ── API Key Validation ──────────────────────────────────────────────────────

function validateApiKey(key: string): { valid: boolean; reason?: string } {
  if (!key || key.trim().length === 0) {
    return { valid: false, reason: 'GEMINI_API_KEY is not set in environment variables.' };
  }
  if (key === 'your_google_gemini_api_key' || key === 'your_real_google_gemini_api_key') {
    return { valid: false, reason: 'GEMINI_API_KEY is still set to a placeholder value. Replace it with your actual API key.' };
  }
  if (!key.startsWith('AIza')) {
    return { valid: false, reason: `GEMINI_API_KEY format looks incorrect (expected prefix "AIza", got "${key.substring(0, 4)}"). Verify your key in Google AI Studio.` };
  }
  if (key.length < 30) {
    return { valid: false, reason: 'GEMINI_API_KEY appears too short. Verify you copied the full key.' };
  }
  return { valid: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractGeminiText(payload: GeminiResponse): string {
  return (
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || ''
  );
}

function parseGeminiJson(text: string): Partial<GeminiIncidentInsight> {
  // Strip markdown code fences if present
  const normalized = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(normalized) as Partial<GeminiIncidentInsight>;
}

/**
 * Logs detailed, categorized error information for Gemini API failures.
 */
function logGeminiError(context: string, status: number | null, error: unknown): void {
  const timestamp = new Date().toISOString();
  const separator = '─'.repeat(60);

  console.error(`\n${separator}`);
  console.error(`[GEMINI ERROR] ${timestamp}`);
  console.error(`Context: ${context}`);

  if (status === 403) {
    console.error('Status: 403 PERMISSION_DENIED');
    console.error('Diagnosis: The API key lacks permission to access the Gemini API.');
    console.error('Common causes:');
    console.error('  1. "Generative Language API" is NOT enabled in Google Cloud Console');
    console.error('     → Go to: https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com');
    console.error('  2. Billing is not active on the Google Cloud project');
    console.error('     → Go to: https://console.cloud.google.com/billing');
    console.error('  3. API key has IP/referrer restrictions blocking this server');
    console.error('     → Go to: https://console.cloud.google.com/apis/credentials');
    console.error('  4. API key belongs to a different project than where the API is enabled');
    console.error('     → Verify the project in Google AI Studio: https://aistudio.google.com/apikey');
  } else if (status === 401) {
    console.error('Status: 401 UNAUTHORIZED');
    console.error('Diagnosis: The API key is invalid or expired.');
    console.error('Fix: Generate a new key at https://aistudio.google.com/apikey');
  } else if (status === 429) {
    console.error('Status: 429 RATE_LIMITED');
    console.error('Diagnosis: Too many requests. You have exceeded your quota.');
    console.error('Fix: Wait a moment and try again, or upgrade your API plan.');
  } else if (status === 404) {
    console.error(`Status: 404 NOT_FOUND`);
    console.error(`Diagnosis: The model "${GEMINI_MODEL}" may not exist or is not available.`);
    console.error('Fix: Try changing GEMINI_MODEL to "gemini-1.5-flash" or "gemini-pro" in your .env file.');
  } else if (status === null) {
    console.error('Status: NETWORK_ERROR');
    console.error('Diagnosis: Could not reach the Gemini API server.');
    console.error('Common causes:');
    console.error('  1. No internet connection');
    console.error('  2. DNS resolution failure');
    console.error('  3. Firewall blocking outgoing HTTPS requests');
    console.error('  4. Proxy misconfiguration');
  } else {
    console.error(`Status: ${status}`);
  }

  if (error instanceof Error) {
    console.error(`Error message: ${error.message}`);
  } else if (error) {
    console.error('Error details:', error);
  }

  console.error(separator + '\n');
}

// ── Core API Call ───────────────────────────────────────────────────────────

/**
 * Makes a request to the Gemini API with automatic version fallback.
 * Tries v1beta first, then v1 if the first fails with 404.
 */
async function callGeminiApi(prompt: string): Promise<{ text: string; success: boolean }> {
  // Validate API key first
  const keyCheck = validateApiKey(GEMINI_API_KEY);
  if (!keyCheck.valid) {
    console.error(`[GEMINI] API Key validation failed: ${keyCheck.reason}`);
    return { text: '', success: false };
  }

  let lastError: unknown = null;
  let lastStatus: number | null = null;

  for (const version of GEMINI_API_VERSIONS) {
    const url = buildApiUrl(version, GEMINI_MODEL);

    try {
      console.log(`[GEMINI] Calling ${version}/models/${GEMINI_MODEL}:generateContent ...`);

      const response = await fetch(`${url}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.2,
          },
        }),
      });

      lastStatus = response.status;

      if (!response.ok) {
        // Try to read error body for better diagnostics
        let errorBody: GeminiErrorResponse = {};
        try {
          errorBody = (await response.json()) as GeminiErrorResponse;
        } catch {
          // ignore JSON parse failure on error responses
        }

        // If 404, the model might not exist on this API version — try next version
        if (response.status === 404 && version !== GEMINI_API_VERSIONS[GEMINI_API_VERSIONS.length - 1]) {
          console.warn(`[GEMINI] Model not found on ${version}, trying next API version...`);
          lastError = new Error(errorBody.error?.message || `HTTP ${response.status}`);
          continue;
        }

        const errorMsg = errorBody.error?.message || `HTTP ${response.status} ${response.statusText}`;
        lastError = new Error(errorMsg);
        logGeminiError('API request failed', response.status, lastError);
        return { text: '', success: false };
      }

      const payload = (await response.json()) as GeminiResponse;

      // Check for API-level errors in the response body
      if (payload.error) {
        logGeminiError('API returned error in response body', payload.error.code || null, new Error(payload.error.message));
        return { text: '', success: false };
      }

      const resultText = extractGeminiText(payload);
      console.log(`[GEMINI] ✓ Success via ${version}. Response length: ${resultText.length} chars`);

      if (!resultText) {
        console.warn('[GEMINI] Warning: API returned success but response text is empty.');
      }

      return { text: resultText, success: true };
    } catch (error) {
      lastError = error;
      lastStatus = null;

      // Network errors — no point retrying with different version
      if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
        logGeminiError('Network error', null, error);
        return { text: '', success: false };
      }

      // For other errors, try next version if available
      if (version !== GEMINI_API_VERSIONS[GEMINI_API_VERSIONS.length - 1]) {
        console.warn(`[GEMINI] Error on ${version}, trying next API version...`, error);
        continue;
      }
    }
  }

  // All versions exhausted
  logGeminiError('All API versions failed', lastStatus, lastError);
  return { text: '', success: false };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Translates text to a target language using the Gemini API.
 * Returns original text as fallback if translation fails.
 *
 * @param text - The text to translate
 * @param targetLang - Target language (e.g. "English", "Hindi", "Spanish")
 * @returns The translated text, or the original text on failure
 */
export async function translateText(text: string, targetLang: string): Promise<string> {
  if (!text.trim()) return text;

  const prompt = `Translate the following text into ${targetLang}. Return valid JSON only with a single key "translatedText" containing the translation.\n\nText: """${text}"""`;

  const result = await callGeminiApi(prompt);

  if (!result.success || !result.text) {
    console.warn(`[GEMINI] translateText fallback: returning original text`);
    return text;
  }

  try {
    const parsed = JSON.parse(
      result.text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
    ) as { translatedText?: string };
    return parsed.translatedText?.trim() || text;
  } catch {
    // If the response isn't valid JSON, try to use it directly
    console.warn('[GEMINI] translateText: response was not valid JSON, using raw text');
    return result.text.trim() || text;
  }
}

/**
 * Translates a guest emergency message and generates an AI summary.
 * This is the primary function used during SOS alert creation.
 *
 * @param text - Guest's emergency message
 * @param sourceLang - Optional language hint (e.g. "Hindi", "Auto-detect")
 * @returns Translation, detected language, and AI summary
 */
export async function translateAndSummarizeIncident(text: string, sourceLang?: string): Promise<GeminiIncidentInsight> {
  const fallback: GeminiIncidentInsight = {
    translatedText: text,
    detectedLanguage: sourceLang || 'Unknown',
    summary: text ? 'Guest message received. Review original text for details.' : '',
  };

  if (!text.trim()) {
    return fallback;
  }

  // Validate API key before attempting the call
  const keyCheck = validateApiKey(GEMINI_API_KEY);
  if (!keyCheck.valid) {
    console.error(`[GEMINI] Skipping translation — ${keyCheck.reason}`);
    return fallback;
  }

  const prompt = [
    'You are assisting a hotel emergency response platform.',
    'Translate the guest message into concise English and create a one-line emergency summary for hotel staff.',
    'Return valid JSON only with keys: translatedText, detectedLanguage, summary.',
    'Keep summary under 140 characters.',
    `Reported source language hint: ${sourceLang || 'Unknown'}.`,
    `Guest message: """${text}"""`,
  ].join('\n');

  const result = await callGeminiApi(prompt);

  if (!result.success || !result.text) {
    console.warn('[GEMINI] translateAndSummarizeIncident: API call failed, using fallback values');
    return fallback;
  }

  try {
    const parsed = parseGeminiJson(result.text);

    console.log('[GEMINI] Parsed incident insight:', {
      translatedText: parsed.translatedText?.substring(0, 50) + '...',
      detectedLanguage: parsed.detectedLanguage,
      summary: parsed.summary?.substring(0, 50) + '...',
    });

    return {
      translatedText: parsed.translatedText?.trim() || text,
      detectedLanguage: parsed.detectedLanguage?.trim() || sourceLang || 'Unknown',
      summary: parsed.summary?.trim() || (text ? 'Guest message received. Review translated text for details.' : ''),
    };
  } catch (parseError) {
    console.error('[GEMINI] Failed to parse Gemini JSON response:', parseError);
    console.error('[GEMINI] Raw response text:', result.text);
    return fallback;
  }
}

/**
 * Checks if the Gemini API is properly configured and reachable.
 * Useful for health checks and debugging.
 */
export async function checkGeminiHealth(): Promise<{
  status: 'ok' | 'error';
  model: string;
  keyValid: boolean;
  keyReason?: string;
  apiReachable?: boolean;
  error?: string;
}> {
  const keyCheck = validateApiKey(GEMINI_API_KEY);

  if (!keyCheck.valid) {
    return {
      status: 'error',
      model: GEMINI_MODEL,
      keyValid: false,
      keyReason: keyCheck.reason,
    };
  }

  try {
    const result = await callGeminiApi('Respond with valid JSON: {"status": "ok"}');
    return {
      status: result.success ? 'ok' : 'error',
      model: GEMINI_MODEL,
      keyValid: true,
      apiReachable: result.success,
      error: result.success ? undefined : 'API call failed. Check server logs for details.',
    };
  } catch (error) {
    return {
      status: 'error',
      model: GEMINI_MODEL,
      keyValid: true,
      apiReachable: false,
      error: error instanceof Error ? error.message : 'Unknown error during health check',
    };
  }
}
