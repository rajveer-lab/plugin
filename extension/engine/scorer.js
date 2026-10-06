/**
 * Hallucination Scorer with Information-Weighting and Grounding Verification.
 *
 * Implements reverify principles:
 * - Computes verifiedWeight as sum of supported informative claim weights.
 * - Enforces grounded check: no contradictions AND verifiedWeight >= minInformation.
 * - Prevents filler from diluting hallucination score.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  /**
   * Splits the answer's information into confirmed / hallucinated / unverified, as whole-number
   * percentages that add up to exactly 100 (all 0 when there's nothing specific to check).
   * Each claim counts by its information weight, so filler and repeats of the question (weight 0)
   * don't dilute the result. A contradicted claim always counts. Unverified is never hallucinated.
   */
  function breakdown(list) {
    const totals = { confirmed: 0, hallucinated: 0, unverified: 0 };
    for (const v of list) {
      const w = typeof v.weight === "number" && v.weight > 0 ? v.weight : 0;
      if (v.status === "contradicted") totals.hallucinated += Math.max(0.4, w);
      else if (v.status === "supported") totals.confirmed += w;
      else totals.unverified += w;
    }
    const keys = Object.keys(totals);
    const sum = keys.reduce((total, key) => total + totals[key], 0);
    const result = { confirmed: 0, hallucinated: 0, unverified: 0 };
    if (!sum) return result;

    // Largest remainder, so the shares always add up to 100
    const exact = keys.map((key) => ({ key, value: (100 * totals[key]) / sum }));
    exact.forEach(({ key, value }) => (result[key] = Math.floor(value)));
    let left = 100 - keys.reduce((total, key) => total + result[key], 0);
    for (const { key } of [...exact].sort((a, b) => (b.value % 1) - (a.value % 1))) {
      if (left <= 0) break;
      result[key]++;
      left--;
    }
    // A share that exists never shows as 0% (one small conflict must not read "0% hallucinated")
    for (const key of keys) {
      if (totals[key] > 0 && result[key] === 0) {
        const largest = keys.reduce((a, b) => (result[b] > result[a] ? b : a));
        result[largest]--;
        result[key] = 1;
      }
    }
    return result;
  }

  function score(verdicts, options) {
    const minInformation = (options && typeof options.minInformation === "number")
      ? options.minInformation
      : 1.0;

    const list = Array.isArray(verdicts) ? verdicts : [];
    if (!list.length) {
      return {
        riskLevel: "LOW",
        hallucinationScore: 0.0,
        confidenceScore: 1.0,
        verifiedWeight: 0.0,
        grounded: false,
        counts: { supported: 0, unsupported: 0, contradicted: 0 },
        breakdown: breakdown([]),
        verdicts: [],
      };
    }

    let supportedCount = 0;
    let unsupportedCount = 0;
    let contradictedCount = 0;
    let verifiedWeight = 0.0;

    let totalWeight = 0.0;
    let penaltyWeight = 0.0;
    let totalConfidence = 0.0;

    for (const v of list) {
      const w = typeof v.weight === "number" ? v.weight : 1.0;
      // Effective weight floor prevents zero-weight claims from bypassing penalty
      const effectiveW = Math.max(0.4, w);
      totalWeight += effectiveW;
      totalConfidence += (typeof v.confidence === "number" ? v.confidence : 0.5);

      if (v.status === "supported") {
        supportedCount++;
        verifiedWeight += w;
      } else if (v.status === "contradicted") {
        contradictedCount++;
        // Contradictions carry double penalty weight
        penaltyWeight += effectiveW * 1.5;
      } else {
        unsupportedCount++;
        penaltyWeight += effectiveW * 0.5;
      }
    }

    const rawHallucinationScore = totalWeight > 0 ? penaltyWeight / totalWeight : 0.0;
    const hallucinationScore = Math.round(Math.min(1.0, Math.max(0.0, rawHallucinationScore)) * 1000) / 1000;
    const confidenceScore = Math.round((totalConfidence / list.length) * 1000) / 1000;
    verifiedWeight = Math.round(verifiedWeight * 10) / 10;

    // Grounded requires ZERO contradictions and sufficient verified informative weight
    const grounded = (contradictedCount === 0) && (verifiedWeight >= minInformation);

    let riskLevel = "LOW";
    const hasHeavyContradiction = list.some(
      (v) => v.status === "contradicted" && (typeof v.weight === "number" ? v.weight : 1.0) >= 1.0
    );
    if (contradictedCount >= 2 || (contradictedCount === 1 && hasHeavyContradiction && hallucinationScore >= 0.5)) {
      riskLevel = "CRITICAL";
    } else if (contradictedCount >= 1 || hallucinationScore >= 0.65) {
      riskLevel = "HIGH";
    } else if (hallucinationScore >= 0.3 || !grounded) {
      riskLevel = "MEDIUM";
    } else {
      riskLevel = "LOW";
    }

    // C-27: Cap risk at HIGH when answer has fewer than 3 weighted claims
    const weightedClaimCount = list.filter((v) => (typeof v.weight === "number" ? v.weight : 1.0) > 0).length;
    if (weightedClaimCount < 3 && riskLevel === "CRITICAL") {
      riskLevel = "HIGH";
    }

    return {
      riskLevel: riskLevel,
      hallucinationScore: hallucinationScore,
      confidenceScore: confidenceScore,
      verifiedWeight: verifiedWeight,
      grounded: grounded,
      counts: {
        supported: supportedCount,
        unsupported: unsupportedCount,
        contradicted: contradictedCount,
      },
      breakdown: breakdown(list),
      verdicts: list,
    };
  }

  AH.scorer = {
    score,
    breakdown,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.scorer;
  }
})(globalThis);
