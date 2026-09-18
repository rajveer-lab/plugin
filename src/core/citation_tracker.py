"""Citation Tracker and Grounding Attribution Module.

Maps generated sentences to reference source passages, generates inline citations,
and flags sentences that lack empirical attribution.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .claim_extractor import ClaimExtractor
from .verifier import FactVerifier, VerificationStatus


@dataclass
class GroundedSentence:
    """A sentence annotated with verified citations or flagged as ungrounded."""
    sentence_idx: int
    text: str
    is_grounded: bool
    citation_id: Optional[str] = None
    matched_source_snippet: Optional[str] = None
    attribution_score: float = 0.0


@dataclass
class CitationReport:
    """Full citation and attribution breakdown for an output text."""
    total_sentences: int
    grounded_sentences: int
    ungrounded_sentences: int
    attribution_coverage: float  # Percentage of sentences with valid citations
    annotated_text: str
    sentences: List[GroundedSentence] = field(default_factory=list)


class CitationTracker:
    """Binds claims to explicit document sources and formats verified citations."""

    def __init__(self, attribution_threshold: float = 0.5):
        self.extractor = ClaimExtractor()
        self.verifier = FactVerifier(support_threshold=attribution_threshold)
        self.attribution_threshold = attribution_threshold

    def attribute(self, generated_text: str, sources: Dict[str, str]) -> CitationReport:
        """Attributes each sentence in generated_text to a source in sources {source_id: source_text}."""
        sentences = self.extractor.split_into_sentences(generated_text)
        if not sentences or not sources:
            return CitationReport(
                total_sentences=len(sentences),
                grounded_sentences=0,
                ungrounded_sentences=len(sentences),
                attribution_coverage=0.0,
                annotated_text=generated_text,
                sentences=[],
            )

        grounded_list: List[GroundedSentence] = []
        annotated_parts: List[str] = []

        for idx, sentence in enumerate(sentences):
            best_source_id: Optional[str] = None
            best_score = 0.0
            best_snippet: Optional[str] = None

            # Check sentence against each source document
            claims = self.extractor.extract_atomic_propositions(sentence)
            for src_id, src_text in sources.items():
                for claim_text in claims:
                    score, _ = self.verifier._compute_overlap(claim_text, src_text)
                    if score > best_score:
                        best_score = score
                        best_source_id = src_id
                        best_snippet = src_text[:120] + "..." if len(src_text) > 120 else src_text

            is_grounded = best_score >= self.attribution_threshold and best_source_id is not None
            if is_grounded:
                citation_tag = f" [{best_source_id}]"
                annotated_parts.append(sentence + citation_tag)
            else:
                annotated_parts.append(sentence + " [UNVERIFIED]")

            grounded_list.append(
                GroundedSentence(
                    sentence_idx=idx,
                    text=sentence,
                    is_grounded=is_grounded,
                    citation_id=best_source_id if is_grounded else None,
                    matched_source_snippet=best_snippet if is_grounded else None,
                    attribution_score=round(best_score, 2),
                )
            )

        grounded_count = sum(1 for s in grounded_list if s.is_grounded)
        coverage = round((grounded_count / len(sentences)) * 100, 1) if sentences else 0.0
        annotated_text = " ".join(annotated_parts)

        return CitationReport(
            total_sentences=len(sentences),
            grounded_sentences=grounded_count,
            ungrounded_sentences=len(sentences) - grounded_count,
            attribution_coverage=coverage,
            annotated_text=annotated_text,
            sentences=grounded_list,
        )
