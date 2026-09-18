"""Fact Verification Engine.

Validates atomic claims against provided ground truth context or external retrieval passages.
Detects contradictions, confirms factual support, and flags unsupported statements.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple

from .claim_extractor import AtomicClaim


class VerificationStatus(str, Enum):
    SUPPORTED = "supported"
    CONTRADICTED = "contradicted"
    UNSUPPORTED = "unsupported"


@dataclass
class VerificationResult:
    """Outcome of verifying a single atomic claim against reference evidence."""
    claim_id: str
    claim_text: str
    status: VerificationStatus
    confidence: float
    matched_evidence: Optional[str] = None
    reasoning: str = ""


class FactVerifier:
    """Verifies claims against reference evidence passages."""

    def __init__(self, support_threshold: float = 0.55, contradiction_threshold: float = 0.35):
        self.support_threshold = support_threshold
        self.contradiction_threshold = contradiction_threshold
        self.negation_words = {"not", "never", "no", "neither", "nor", "none", "cannot", "n't", "refused", "failed"}

    def _tokenize(self, text: str) -> set[str]:
        """Normalizes and tokenizes text into word stems/lowercase tokens."""
        words = re.findall(r"\b\w+\b", text.lower())
        stopwords = {
            "a", "an", "the", "in", "on", "at", "to", "for", "with", "by", "from",
            "is", "was", "are", "were", "been", "be", "it", "this", "that", "of"
        }
        return {w for w in words if w not in stopwords}

    def _contains_negation(self, text: str) -> bool:
        """Detects explicit negation terms."""
        tokens = re.findall(r"\b\w+\b", text.lower())
        return any(neg in tokens for neg in self.negation_words)

    def _compute_overlap(self, text_a: str, text_b: str) -> Tuple[float, List[str]]:
        """Computes Jaccard/token overlap between claim and candidate evidence."""
        tokens_a = self._tokenize(text_a)
        tokens_b = self._tokenize(text_b)
        if not tokens_a or not tokens_b:
            return 0.0, []

        intersection = tokens_a.intersection(tokens_b)
        overlap_score = len(intersection) / len(tokens_a)
        return overlap_score, list(intersection)

    def verify_claim(self, claim: AtomicClaim, evidence_passages: List[str]) -> VerificationResult:
        """Verifies a single claim across all available evidence passages."""
        if not evidence_passages:
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.UNSUPPORTED,
                confidence=0.0,
                reasoning="No reference evidence passages were provided.",
            )

        best_passage = None
        best_score = 0.0
        best_common: List[str] = []

        for passage in evidence_passages:
            score, common = self._compute_overlap(claim.text, passage)
            if score > best_score:
                best_score = score
                best_passage = passage
                best_common = common

        if not best_passage or best_score < 0.2:
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.UNSUPPORTED,
                confidence=round(1.0 - best_score, 2),
                matched_evidence=None,
                reasoning=f"Insufficient textual overlap ({best_score:.2f}) with available reference context.",
            )

        # Check for polarity / negation contradiction
        claim_neg = self._contains_negation(claim.text)
        evidence_neg = self._contains_negation(best_passage)
        polarity_mismatch = (claim_neg != evidence_neg)

        # Check entity preservation
        missing_entities = [e for e in claim.entities if e.lower() not in best_passage.lower()]
        entity_penalty = len(missing_entities) * 0.15

        effective_score = max(0.0, best_score - entity_penalty)

        # Check temporal / year contradiction
        claim_years = re.findall(r"\b(?:18|19|20)\d{2}\b", claim.text)
        evidence_years = re.findall(r"\b(?:18|19|20)\d{2}\b", best_passage)
        if claim_years and evidence_years and not set(claim_years).intersection(set(evidence_years)):
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.CONTRADICTED,
                confidence=0.95,
                matched_evidence=best_passage.strip(),
                reasoning=f"Year mismatch: Claim states {claim_years} but reference evidence states {evidence_years}.",
            )

        claim_nums = re.findall(r"\b\d+(?:\.\d+)?\b", claim.text)
        evidence_nums = re.findall(r"\b\d+(?:\.\d+)?\b", best_passage)
        if claim_nums and evidence_nums and not set(claim_nums).intersection(set(evidence_nums)) and best_score >= self.contradiction_threshold:
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.CONTRADICTED,
                confidence=0.90,
                matched_evidence=best_passage.strip(),
                reasoning=f"Numerical conflict: Claim numbers {claim_nums} conflict with evidence {evidence_nums}.",
            )

        if polarity_mismatch and best_score >= self.contradiction_threshold:
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.CONTRADICTED,
                confidence=round(min(1.0, best_score + 0.2), 2),
                matched_evidence=best_passage.strip(),
                reasoning=f"Polarity conflict detected between claim and evidence: '{best_passage.strip()}'",
            )

        if effective_score >= self.support_threshold:
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.SUPPORTED,
                confidence=round(min(1.0, effective_score), 2),
                matched_evidence=best_passage.strip(),
                reasoning=f"High semantic alignment ({effective_score:.2f}) with evidence passage.",
            )
        else:
            return VerificationResult(
                claim_id=claim.id,
                claim_text=claim.text,
                status=VerificationStatus.UNSUPPORTED,
                confidence=round(effective_score, 2),
                matched_evidence=best_passage.strip(),
                reasoning=f"Partial overlap ({effective_score:.2f}) is below verification threshold ({self.support_threshold}).",
            )

    def verify_all(self, claims: List[AtomicClaim], evidence_passages: List[str]) -> List[VerificationResult]:
        """Runs batch verification on a collection of claims."""
        return [self.verify_claim(c, evidence_passages) for c in claims]
