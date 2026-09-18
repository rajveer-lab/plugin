"""Hallucination Scorer and Risk Assessment Module.

Aggregates individual claim verification results into holistic hallucination metrics,
uncertainty boundaries, and actionable risk categories.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List

from .verifier import VerificationResult, VerificationStatus


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass
class HallucinationReport:
    """Holistic diagnostic report on model output factuality."""
    total_claims: int
    supported_claims: int
    contradicted_claims: int
    unsupported_claims: int
    hallucination_score: float  # 0.0 = completely faithful, 1.0 = total hallucination
    confidence_score: float     # 0.0 to 1.0 overall certainty
    risk_level: RiskLevel
    verdict: str
    detailed_results: List[VerificationResult] = field(default_factory=list)
    breakdown: Dict[str, Any] = field(default_factory=dict)


class HallucinationScorer:
    """Calculates overall hallucination index and risk rating from verification outcomes."""

    def __init__(self, contradiction_weight: float = 1.0, unsupported_weight: float = 0.5):
        self.contradiction_weight = contradiction_weight
        self.unsupported_weight = unsupported_weight

    def score(self, verification_results: List[VerificationResult]) -> HallucinationReport:
        """Computes composite hallucination index and categorical risk."""
        total = len(verification_results)
        if total == 0:
            return HallucinationReport(
                total_claims=0,
                supported_claims=0,
                contradicted_claims=0,
                unsupported_claims=0,
                hallucination_score=0.0,
                confidence_score=1.0,
                risk_level=RiskLevel.LOW,
                verdict="No claims found in text.",
                detailed_results=[],
                breakdown={"notes": "Empty or non-factual input."},
            )

        supported = sum(1 for r in verification_results if r.status == VerificationStatus.SUPPORTED)
        contradicted = sum(1 for r in verification_results if r.status == VerificationStatus.CONTRADICTED)
        unsupported = sum(1 for r in verification_results if r.status == VerificationStatus.UNSUPPORTED)

        # Weighted penalty: contradictions count 2x as severe as unverified claims
        penalty = (contradicted * self.contradiction_weight) + (unsupported * self.unsupported_weight)
        max_possible_penalty = total * self.contradiction_weight
        raw_score = penalty / max_possible_penalty if max_possible_penalty > 0 else 0.0
        hallucination_score = round(min(1.0, max(0.0, raw_score)), 3)

        # Average confidence of all verifications
        avg_confidence = sum(r.confidence for r in verification_results) / total
        confidence_score = round(avg_confidence, 3)

        # Determine risk level
        if contradicted > 0 or hallucination_score >= 0.65:
            risk_level = RiskLevel.CRITICAL if contradicted >= 2 else RiskLevel.HIGH
        elif hallucination_score >= 0.3:
            risk_level = RiskLevel.MEDIUM
        else:
            risk_level = RiskLevel.LOW

        verdict_map = {
            RiskLevel.LOW: "High fidelity: Output is solidly grounded in provided evidence.",
            RiskLevel.MEDIUM: "Moderate risk: Several statements could not be verified.",
            RiskLevel.HIGH: "High hallucination risk: Multiple ungrounded or unsupported claims.",
            RiskLevel.CRITICAL: "Critical alert: Direct factual contradiction detected.",
        }

        return HallucinationReport(
            total_claims=total,
            supported_claims=supported,
            contradicted_claims=contradicted,
            unsupported_claims=unsupported,
            hallucination_score=hallucination_score,
            confidence_score=confidence_score,
            risk_level=risk_level,
            verdict=verdict_map[risk_level],
            detailed_results=verification_results,
            breakdown={
                "supported_ratio": round(supported / total, 3),
                "contradicted_ratio": round(contradicted / total, 3),
                "unsupported_ratio": round(unsupported / total, 3),
            },
        )
