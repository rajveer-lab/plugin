"""Self-Consistency and Multi-Sample Consensus Checker (SelfCheckGPT pattern).

Evaluates model outputs across stochastic generation samples. When an AI model
hallucinates, facts typically vary wildly between independent completions.
High consensus across samples signifies robust factual recall; divergence indicates hallucination.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .claim_extractor import AtomicClaim, ClaimExtractor
from .verifier import FactVerifier, VerificationStatus


@dataclass
class ConsistencyScore:
    """Consistency outcome for a single claim across multiple response variations."""
    claim_id: str
    claim_text: str
    sample_support_count: int
    sample_contradict_count: int
    sample_neutral_count: int
    total_samples: int
    consistency_rate: float  # 0.0 to 1.0 (1.0 = supported by all samples)
    is_stable: bool


@dataclass
class ConsistencyReport:
    """Comprehensive multi-sample consistency diagnostic report."""
    total_claims: int
    stable_claims: int
    unstable_claims: int
    overall_consistency_score: float
    claims_consistency: List[ConsistencyScore] = field(default_factory=list)


class ConsistencyChecker:
    """Analyzes factual stability across multiple stochastic completions of the same prompt."""

    def __init__(self, stability_threshold: float = 0.6):
        self.extractor = ClaimExtractor()
        self.verifier = FactVerifier()
        self.stability_threshold = stability_threshold

    def check_consistency(
        self,
        primary_response: str,
        sampled_responses: List[str]
    ) -> ConsistencyReport:
        """Compares the primary response's claims against stochastic sample responses."""
        claims = self.extractor.extract(primary_response)
        if not claims or not sampled_responses:
            return ConsistencyReport(
                total_claims=len(claims),
                stable_claims=0,
                unstable_claims=0,
                overall_consistency_score=1.0 if not claims else 0.0,
                claims_consistency=[],
            )

        results: List[ConsistencyScore] = []
        total_samples = len(sampled_responses)

        for claim in claims:
            support_count = 0
            contradict_count = 0
            neutral_count = 0

            for sample in sampled_responses:
                # Treat each sample as a candidate evidence document
                verification = self.verifier.verify_claim(claim, [sample])
                if verification.status == VerificationStatus.SUPPORTED:
                    support_count += 1
                elif verification.status == VerificationStatus.CONTRADICTED:
                    contradict_count += 1
                else:
                    neutral_count += 1

            # Consistency rate penalizes contradictions
            rate = max(0.0, (support_count - (contradict_count * 1.5)) / total_samples)
            is_stable = (rate >= self.stability_threshold) and (contradict_count == 0)

            results.append(
                ConsistencyScore(
                    claim_id=claim.id,
                    claim_text=claim.text,
                    sample_support_count=support_count,
                    sample_contradict_count=contradict_count,
                    sample_neutral_count=neutral_count,
                    total_samples=total_samples,
                    consistency_rate=round(rate, 2),
                    is_stable=is_stable,
                )
            )

        stable_count = sum(1 for r in results if r.is_stable)
        avg_rate = sum(r.consistency_rate for r in results) / len(results) if results else 0.0

        return ConsistencyReport(
            total_claims=len(claims),
            stable_claims=stable_count,
            unstable_claims=len(claims) - stable_count,
            overall_consistency_score=round(avg_rate, 2),
            claims_consistency=results,
        )
