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
      verdicts: list,
    };
  }

  AH.scorer = {
    score,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.scorer;
  }
})(globalThis);
