"""Hallucination Mitigator (post-generation guardrail).

Takes a model response plus verification results from src.core and rewrites it:
supported sentences get citations and confidence tags, unsupported ones are flagged
or removed, and contradicted ones are replaced with what the evidence actually says.

Mitigation works per sentence: a sentence takes the worst verdict among its claims.

Run standalone (offline demo):
    python -m src.guardrails.mitigator
"""

from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

from ..connectors.search_retriever import EvidencePassage
from ..core.claim_extractor import AtomicClaim, ClaimExtractor
from ..core.scorer import HallucinationReport, HallucinationScorer, RiskLevel
from ..core.verifier import FactVerifier, VerificationResult, VerificationStatus
from .prompt_grounder import Strictness

_CITATION = re.compile(r"\s*\[S\d+(?:\s*[;,][^\]]*)?\]")
_TRAILING_PUNCTUATION = re.compile(r"([.!?]+[\"')\]]*)$")
_RISK_ORDER = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]
_SEVERITY = {
    VerificationStatus.SUPPORTED: 0,
    VerificationStatus.UNSUPPORTED: 1,
    VerificationStatus.CONTRADICTED: 2,
}

# Optional hook for LLM-based rewrites: (sentence, contradicting result, evidence text) -> replacement
Rewriter = Callable[[str, VerificationResult, str], str]


class MitigationAction(str, Enum):
    KEEP = "keep"
    CITE = "cite"
    FLAG = "flag"
    REDACT = "redact"
    CORRECT = "correct"


@dataclass
class MitigationPolicy:
    """What to do with sentences for each verification status."""
    on_supported: MitigationAction = MitigationAction.CITE
    on_unsupported: MitigationAction = MitigationAction.FLAG
    on_contradicted: MitigationAction = MitigationAction.CORRECT
    annotate_confidence: bool = True
    block_risk_level: Optional[RiskLevel] = None  # withhold the whole response at or above this risk
    unverified_marker: str = "[UNVERIFIED]"
    redaction_template: str = "[Removed: {reason}.]"
    block_message: str = "This response was withheld because it conflicts with the reference sources."

    def __post_init__(self):
        # Accept plain strings from config files
        self.on_supported = MitigationAction(self.on_supported)
        self.on_unsupported = MitigationAction(self.on_unsupported)
        self.on_contradicted = MitigationAction(self.on_contradicted)
        if self.block_risk_level is not None and not isinstance(self.block_risk_level, RiskLevel):
            self.block_risk_level = RiskLevel(str(self.block_risk_level).upper())

    @classmethod
    def for_strictness(cls, strictness: Union[Strictness, str]) -> "MitigationPolicy":
        level = Strictness(strictness)
        if level is Strictness.MODERATE:
            return cls(on_unsupported=MitigationAction.KEEP, annotate_confidence=False)
        if level is Strictness.ZERO_TOLERANCE:
            return cls(
                on_unsupported=MitigationAction.REDACT,
                on_contradicted=MitigationAction.REDACT,
                block_risk_level=RiskLevel.CRITICAL,
            )
        return cls()


@dataclass
class SentenceMitigation:
    """What happened to one sentence of the response."""
    sentence_idx: int
    original: str
    revised: str
    status: VerificationStatus
    action: MitigationAction
    confidence: float
    citations: List[str] = field(default_factory=list)
    claim_ids: List[str] = field(default_factory=list)
    reasoning: str = ""


@dataclass
class MitigationResult:
    """The rewritten response and a per-sentence record of the changes."""
    original_text: str
    mitigated_text: str
    report: HallucinationReport
    sentences: List[SentenceMitigation] = field(default_factory=list)
    blocked: bool = False

    @property
    def changed(self) -> bool:
        return self.mitigated_text != self.original_text

    def summary(self) -> Dict[str, Any]:
        """JSON-serializable summary for API responses and logs."""
        return {
            "risk_level": self.report.risk_level.value,
            "hallucination_score": self.report.hallucination_score,
            "confidence_score": self.report.confidence_score,
            "verdict": self.report.verdict,
            "blocked": self.blocked,
            "changed": self.changed,
            "counts": {
                "supported": self.report.supported_claims,
                "unsupported": self.report.unsupported_claims,
                "contradicted": self.report.contradicted_claims,
            },
            "sentences": [
                {
                    "index": s.sentence_idx,
                    "status": s.status.value,
                    "action": s.action.value,
                    "confidence": s.confidence,
                    "citations": s.citations,
                    "original": s.original,
                    "revised": s.revised,
                    "reasoning": s.reasoning,
                }
                for s in self.sentences
            ],
        }


class HallucinationMitigator:
    """Rewrites model responses based on claim verification results."""

    def __init__(
        self,
        policy: Optional[MitigationPolicy] = None,
        extractor: Optional[ClaimExtractor] = None,
        verifier: Optional[FactVerifier] = None,
        scorer: Optional[HallucinationScorer] = None,
        rewriter: Optional[Rewriter] = None,
        snippet_chars: int = 200,
    ):
        self.policy = policy or MitigationPolicy()
        self.extractor = extractor or ClaimExtractor()
        self.verifier = verifier or FactVerifier()
        self.scorer = scorer or HallucinationScorer()
        self.rewriter = rewriter
        self.snippet_chars = snippet_chars

    def check_and_mitigate(
        self,
        response_text: str,
        evidence: Sequence[Union[str, EvidencePassage]],
    ) -> MitigationResult:
        """Runs extraction, verification and scoring, then mitigates the response."""
        claims = self.extractor.extract(response_text)
        # Citation markers the model added (e.g. "[S1]") would dilute token overlap during verification
        cleaned = [dataclasses.replace(c, text=_CITATION.sub("", c.text).strip()) for c in claims]
        results = self.verifier.verify_all(cleaned, _evidence_texts(evidence))
        return self.mitigate(response_text, self.scorer.score(results), claims, evidence)

    def mitigate(
        self,
        response_text: str,
        verification: Union[HallucinationReport, Sequence[VerificationResult]],
        claims: Optional[Sequence[AtomicClaim]] = None,
        evidence: Sequence[Union[str, EvidencePassage]] = (),
    ) -> MitigationResult:
        """Applies the policy to each sentence that has verification results.

        Pass the claims the results came from so each result maps to its sentence;
        without them, results are matched to sentences by text.
        Evidence should be in the same order used for grounding, so labels match [S1], [S2], ...
        """
        if isinstance(verification, HallucinationReport):
            report = verification
        else:
            report = self.scorer.score(list(verification))

        sentences = self.extractor.split_into_sentences(response_text)
        spans = _locate(response_text, sentences)
        labels = {_normalize(text): f"S{i + 1}" for i, text in reversed(list(enumerate(_evidence_texts(evidence))))}
        claim_sentence = {c.id: c.sentence_idx for c in claims or []}

        grouped: Dict[int, List[VerificationResult]] = {}
        for result in report.detailed_results:
            idx = claim_sentence.get(result.claim_id)
            if idx is None:
                idx = _find_sentence(result.claim_text, sentences)
            if idx is not None and idx < len(sentences) and spans[idx] is not None:
                grouped.setdefault(idx, []).append(result)

        decisions = [self._decide(idx, sentences[idx], grouped[idx], labels) for idx in sorted(grouped)]

        blocked = bool(
            self.policy.block_risk_level
            and _RISK_ORDER.index(report.risk_level) >= _RISK_ORDER.index(self.policy.block_risk_level)
        )
        if blocked:
            mitigated = self.policy.block_message
        else:
            mitigated = response_text
            for decision in sorted(decisions, key=lambda d: spans[d.sentence_idx][0], reverse=True):
                start, end = spans[decision.sentence_idx]
                if decision.revised:
                    mitigated = mitigated[:start] + decision.revised + mitigated[end:]
                else:
                    # Empty replacement: drop the sentence and the whitespace after it
                    trailing = len(mitigated[end:]) - len(mitigated[end:].lstrip())
                    mitigated = mitigated[:start] + mitigated[end + trailing:]
            mitigated = mitigated.rstrip() if not response_text.endswith((" ", "\n")) else mitigated

        return MitigationResult(
            original_text=response_text,
            mitigated_text=mitigated,
            report=report,
            sentences=decisions,
            blocked=blocked,
        )

    def _decide(
        self,
        idx: int,
        sentence: str,
        results: List[VerificationResult],
        labels: Dict[str, str],
    ) -> SentenceMitigation:
        worst = max(results, key=lambda r: _SEVERITY[r.status])
        status = worst.status
        same_status = [r for r in results if r.status == status]
        if status is VerificationStatus.SUPPORTED:
            confidence = min(r.confidence for r in results)
        else:
            confidence = max(r.confidence for r in same_status)
        reasoning = " ".join(r.reasoning for r in same_status if r.reasoning)
        citations = _unique(labels.get(_normalize(r.matched_evidence or "")) for r in same_status)

        policy = self.policy
        action = {
            VerificationStatus.SUPPORTED: policy.on_supported,
            VerificationStatus.UNSUPPORTED: policy.on_unsupported,
            VerificationStatus.CONTRADICTED: policy.on_contradicted,
        }[status]

        # Fall back when an action doesn't apply to this status or lacks evidence
        if action is MitigationAction.CITE and (status is not VerificationStatus.SUPPORTED or not citations):
            action = MitigationAction.KEEP if status is VerificationStatus.SUPPORTED else MitigationAction.FLAG
        if action is MitigationAction.CORRECT and not worst.matched_evidence:
            action = MitigationAction.REDACT

        if action is MitigationAction.KEEP:
            revised = sentence
        elif action is MitigationAction.CITE:
            tag = ", ".join(citations)
            if policy.annotate_confidence:
                tag += f"; confidence {confidence:.2f}"
            revised = _insert_tag(_CITATION.sub("", sentence), f"[{tag}]")
        elif action is MitigationAction.FLAG:
            revised = _insert_tag(sentence, policy.unverified_marker)
        elif action is MitigationAction.REDACT:
            reason = "contradicted by the sources" if status is VerificationStatus.CONTRADICTED else "could not be verified against the sources"
            revised = policy.redaction_template.format(reason=reason) if policy.redaction_template else ""
        else:  # CORRECT
            evidence_text = worst.matched_evidence.strip()
            label = labels.get(_normalize(evidence_text))
            if self.rewriter is not None:
                revised = self.rewriter(sentence, worst, evidence_text)
            else:
                snippet = evidence_text if len(evidence_text) <= self.snippet_chars else evidence_text[: self.snippet_chars].rstrip() + "..."
                source = f"source {label}" if label else "the source"
                revised = f'[Correction: {source} says "{snippet}"]'

        return SentenceMitigation(
            sentence_idx=idx,
            original=sentence,
            revised=revised,
            status=status,
            action=action,
            confidence=round(confidence, 2),
            citations=citations,
            claim_ids=[r.claim_id for r in results],
            reasoning=reasoning,
        )


def _evidence_texts(evidence: Sequence[Union[str, EvidencePassage]]) -> List[str]:
    return [e.text if isinstance(e, EvidencePassage) else e for e in evidence]


def _normalize(text: str) -> str:
    return " ".join(text.split()).lower()


def _unique(items) -> List[str]:
    seen: List[str] = []
    for item in items:
        if item and item not in seen:
            seen.append(item)
    return seen


def _locate(text: str, sentences: List[str]) -> List[Optional[Tuple[int, int]]]:
    """Finds each sentence's character span in the original text, preserving layout."""
    spans: List[Optional[Tuple[int, int]]] = []
    cursor = 0
    for sentence in sentences:
        start = text.find(sentence, cursor)
        if start == -1:
            spans.append(None)
            continue
        spans.append((start, start + len(sentence)))
        cursor = start + len(sentence)
    return spans


def _find_sentence(claim_text: str, sentences: List[str]) -> Optional[int]:
    needle = claim_text.rstrip(".,; ")
    for idx, sentence in enumerate(sentences):
        if needle and needle in sentence:
            return idx
    return None


def _insert_tag(sentence: str, tag: str) -> str:
    """Places a tag before the sentence's closing punctuation."""
    sentence = sentence.rstrip()
    match = _TRAILING_PUNCTUATION.search(sentence)
    if match:
        return f"{sentence[:match.start()].rstrip()} {tag}{match.group(1)}"
    return f"{sentence} {tag}"


if __name__ == "__main__":
    evidence = [
        "The James Webb Space Telescope (JWST) was launched on December 25, 2021.",
        "JWST operates in the infrared spectrum and is stationed at the Sun-Earth L2 Lagrange point, approximately 1.5 million kilometers from Earth.",
    ]
    response = (
        "The James Webb Space Telescope was launched in 1995. "
        "JWST operates in the infrared spectrum at the Sun-Earth L2 Lagrange point. "
        "It was designed by a team of volunteer astronomers in Iceland."
    )
    for level in Strictness:
        result = HallucinationMitigator(MitigationPolicy.for_strictness(level)).check_and_mitigate(response, evidence)
        print(f"=== {level.value} (risk {result.report.risk_level.value}) ===")
        print(result.mitigated_text)
        print()
