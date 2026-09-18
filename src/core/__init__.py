"""Core anti-hallucination engine package."""

from .citation_tracker import CitationReport, CitationTracker, GroundedSentence
from .claim_extractor import AtomicClaim, ClaimExtractor, ClaimType
from .consistency_checker import ConsistencyChecker, ConsistencyReport, ConsistencyScore
from .scorer import HallucinationReport, HallucinationScorer, RiskLevel
from .verifier import FactVerifier, VerificationResult, VerificationStatus

__all__ = [
    "AtomicClaim",
    "ClaimExtractor",
    "ClaimType",
    "FactVerifier",
    "VerificationResult",
    "VerificationStatus",
    "HallucinationReport",
    "HallucinationScorer",
    "RiskLevel",
    "ConsistencyChecker",
    "ConsistencyReport",
    "ConsistencyScore",
    "CitationTracker",
    "CitationReport",
    "GroundedSentence",
]
